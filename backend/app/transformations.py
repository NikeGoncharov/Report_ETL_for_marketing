"""Data transformation pipeline for reports."""
import ast
import operator
import re
from typing import List, Dict, Any, Optional
from collections import defaultdict
from abc import ABC, abstractmethod


class TransformationError(Exception):
    """Error during data transformation."""
    pass


class BaseTransformation(ABC):
    """Base class for all transformations."""
    
    @abstractmethod
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        """Transform the data according to the configuration."""
        pass


class ExtractTransformation(BaseTransformation):
    """Extract part of a string using regex."""
    
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        column = config.get("column")
        pattern = config.get("pattern")
        output_column = config.get("output_column")
        
        if not all([source, column, pattern, output_column]):
            raise TransformationError("extract requires: source, column, pattern, output_column")
        
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")
        
        try:
            regex = re.compile(pattern)
        except re.error as e:
            raise TransformationError(f"Invalid regex pattern: {e}")
        
        result = []
        for row in data[source]:
            new_row = row.copy()
            value = str(row.get(column, ""))
            match = regex.search(value)
            new_row[output_column] = match.group(1) if match and match.groups() else value
            result.append(new_row)
        
        data[source] = result
        return data


def apply_aggregation(agg_func: str, values: List[Any]) -> Any:
    """Свернуть список значений одной агрегатной функцией (общий код шагов)."""
    if agg_func == "sum":
        return sum(values)
    if agg_func == "avg":
        return sum(values) / len(values) if values else 0
    if agg_func == "count":
        return len(values)
    if agg_func == "min":
        return min(values) if values else 0
    if agg_func == "max":
        return max(values) if values else 0
    if agg_func == "first":
        return values[0] if values else None
    if agg_func == "last":
        return values[-1] if values else None
    raise TransformationError(f"Unknown aggregation function: {agg_func}")


class GroupByTransformation(BaseTransformation):
    """Group data by columns and aggregate."""

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        columns = config.get("columns", [])
        aggregations = config.get("aggregations", {})

        if not source or not columns:
            raise TransformationError("group_by requires: source, columns")

        if source not in data:
            raise TransformationError(f"Source '{source}' not found")

        # Group by columns
        groups = defaultdict(list)
        for row in data[source]:
            key = tuple(row.get(col, "") for col in columns)
            groups[key].append(row)

        # Aggregate
        result = []
        for key, rows in groups.items():
            new_row = {}

            # Set group by columns
            for i, col in enumerate(columns):
                new_row[col] = key[i]

            # Apply aggregations
            for col, agg_func in aggregations.items():
                values = [row.get(col, 0) for row in rows if row.get(col) is not None]
                new_row[col] = apply_aggregation(agg_func, values)

            result.append(new_row)

        data[source] = result
        return data


class MergeRowsTransformation(BaseTransformation):
    """Объединение строк по признаку: строки, где срез подходит под условие
    (например, название кампании содержит «search»), схлопываются в одну.

    Значение среза в объединённой строке = group_name; числовые колонки
    суммируются (или сворачиваются функцией из aggregations), текстовые без
    заданной агрегации остаются пустыми. Несовпавшие строки не меняются.
    """

    OPERATORS = ("contains", "startswith", "endswith", "eq")

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        column = config.get("column")
        op = config.get("operator") or "contains"
        value = config.get("value")
        group_name = config.get("group_name")
        aggregations = config.get("aggregations") or {}

        if not all([source, column, group_name]) or value in (None, ""):
            raise TransformationError("merge_rows requires: source, column, value, group_name")
        if op not in self.OPERATORS:
            raise TransformationError(f"merge_rows: unknown operator '{op}'")
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")

        # Названия кампаний сравниваем без учёта регистра, как в сшивке
        needle = str(value).strip().lower()

        def matches(row: Dict) -> bool:
            cell = str(row.get(column) or "").lower()
            if op == "contains":
                return needle in cell
            if op == "startswith":
                return cell.startswith(needle)
            if op == "endswith":
                return cell.endswith(needle)
            return cell == needle

        rows = data[source]
        matched = [row for row in rows if matches(row)]
        if not matched:
            return data

        columns_seen: List[str] = []
        for row in matched:
            for key in row.keys():
                if key not in columns_seen:
                    columns_seen.append(key)

        merged: Dict[str, Any] = {}
        for col in columns_seen:
            if col == column:
                merged[col] = group_name
                continue
            values = [row.get(col) for row in matched if row.get(col) is not None]
            agg_func = aggregations.get(col)
            if agg_func is None:
                numeric = [
                    v for v in values
                    if isinstance(v, (int, float)) and not isinstance(v, bool)
                ]
                if values and len(numeric) == len(values):
                    agg_func = "sum"
                else:
                    # разные тексты не угадываем — оставляем пусто
                    merged[col] = ""
                    continue
            merged[col] = apply_aggregation(agg_func, values)

        # Объединённая строка встаёт на место первой совпавшей
        result = []
        inserted = False
        for row in rows:
            if matches(row):
                if not inserted:
                    result.append(merged)
                    inserted = True
            else:
                result.append(row)

        data[source] = result
        return data


class JoinTransformation(BaseTransformation):
    """Join two data sources.

    Ключ задаётся либо одним именем `on` (одинаковым с обеих сторон), либо
    парой `left_on`/`right_on` — например campaignname слева и UTMCampaign
    справа. Значения ключей сравниваются как строки без регистра, чтобы
    "Кампания 1" из Директа сматчилась с "кампания 1" из UTM-метки.
    """

    @staticmethod
    def _key(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip().lower()

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        left_source = config.get("left")
        right_source = config.get("right")
        on_column = config.get("on")
        left_on = config.get("left_on") or on_column
        right_on = config.get("right_on") or on_column
        how = config.get("how", "inner")  # inner, left, right, outer
        output_source = config.get("output", left_source)

        if not all([left_source, right_source, left_on, right_on]):
            raise TransformationError("join requires: left, right and on (or left_on + right_on)")

        if left_source not in data:
            raise TransformationError(f"Left source '{left_source}' not found")
        if right_source not in data:
            raise TransformationError(f"Right source '{right_source}' not found")

        left_data = data[left_source]
        right_data = data[right_source]

        # Build index for right data
        right_index = defaultdict(list)
        for row in right_data:
            right_index[self._key(row.get(right_on, ""))].append(row)

        result = []
        used_right_keys = set()

        for left_row in left_data:
            key = self._key(left_row.get(left_on, ""))
            right_rows = right_index.get(key, [])

            if right_rows:
                used_right_keys.add(key)
                for right_row in right_rows:
                    merged = {**left_row}
                    for k, v in right_row.items():
                        if k == right_on:  # Don't duplicate join column
                            continue
                        # Add prefix if column already exists
                        new_key = k if k not in merged else f"right_{k}"
                        merged[new_key] = v
                    result.append(merged)
            elif how in ("left", "outer"):
                result.append(left_row.copy())

        # Add unmatched right rows for outer/right join
        if how in ("right", "outer"):
            for key, right_rows in right_index.items():
                if key not in used_right_keys:
                    for right_row in right_rows:
                        result.append(right_row.copy())

        data[output_source] = result
        return data


class RenameTransformation(BaseTransformation):
    """Rename columns."""
    
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        mapping = config.get("mapping", {})
        
        if not source or not mapping:
            raise TransformationError("rename requires: source, mapping")
        
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")
        
        result = []
        for row in data[source]:
            new_row = {}
            for k, v in row.items():
                new_key = mapping.get(k, k)
                new_row[new_key] = v
            result.append(new_row)
        
        data[source] = result
        return data


class FilterTransformation(BaseTransformation):
    """Filter rows based on condition."""
    
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        column = config.get("column")
        operator = config.get("operator")  # eq, ne, gt, lt, gte, lte, contains, startswith, endswith
        value = config.get("value")
        
        if not all([source, column, operator]):
            raise TransformationError("filter requires: source, column, operator")
        
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")
        
        def matches(row_value):
            if operator == "eq":
                return row_value == value
            elif operator == "ne":
                return row_value != value
            elif operator == "gt":
                return row_value > value
            elif operator == "lt":
                return row_value < value
            elif operator == "gte":
                return row_value >= value
            elif operator == "lte":
                return row_value <= value
            elif operator == "contains":
                return str(value) in str(row_value)
            elif operator == "startswith":
                return str(row_value).startswith(str(value))
            elif operator == "endswith":
                return str(row_value).endswith(str(value))
            elif operator == "is_null":
                return row_value is None or row_value == ""
            elif operator == "not_null":
                return row_value is not None and row_value != ""
            else:
                raise TransformationError(f"Unknown operator: {operator}")
        
        result = [row for row in data[source] if matches(row.get(column))]
        data[source] = result
        return data


# Formulas come from user-supplied report configs, so they are evaluated over
# an AST whitelist instead of eval(): only arithmetic over numbers and column
# names is reachable.
_FORMULA_BINARY_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_FORMULA_UNARY_OPS = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}
_FORMULA_MAX_EXPONENT = 100


def parse_formula(formula: str) -> ast.Expression:
    """Parse a formula and reject anything beyond arithmetic over columns."""
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as e:
        raise TransformationError(f"Invalid formula: {e.msg}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Expression):
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            continue
        if isinstance(node, ast.Name):
            continue
        if isinstance(node, ast.BinOp) and type(node.op) in _FORMULA_BINARY_OPS:
            continue
        if isinstance(node, ast.UnaryOp) and type(node.op) in _FORMULA_UNARY_OPS:
            continue
        if isinstance(node, (ast.operator, ast.unaryop, ast.expr_context)):
            continue
        raise TransformationError(
            "Formula may only contain numbers, column names and + - * / % ** operators"
        )
    return tree


def evaluate_formula(tree: ast.Expression, row: Dict[str, Any]) -> float:
    """Evaluate a parsed formula against one row of data."""

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            value = row.get(node.id)
            return float(value) if value is not None else 0.0
        if isinstance(node, ast.UnaryOp):
            return _FORMULA_UNARY_OPS[type(node.op)](_eval(node.operand))
        if isinstance(node, ast.BinOp):
            left = _eval(node.left)
            right = _eval(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > _FORMULA_MAX_EXPONENT:
                raise ValueError("exponent too large")
            return _FORMULA_BINARY_OPS[type(node.op)](left, right)
        raise ValueError("unsupported expression")

    return _eval(tree)


class CalculateTransformation(BaseTransformation):
    """Add calculated column."""

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        output_column = config.get("output_column")
        formula = config.get("formula")  # e.g., "cost / clicks" or "cost / conversions"

        if not all([source, output_column, formula]):
            raise TransformationError("calculate requires: source, output_column, formula")

        if source not in data:
            raise TransformationError(f"Source '{source}' not found")

        tree = parse_formula(formula)

        result = []
        for row in data[source]:
            new_row = row.copy()
            try:
                result_value = evaluate_formula(tree, row)
                new_row[output_column] = round(result_value, 4) if isinstance(result_value, float) else result_value
            except (ZeroDivisionError, ValueError, TypeError, OverflowError):
                new_row[output_column] = None

            result.append(new_row)

        data[source] = result
        return data


class FindReplaceTransformation(BaseTransformation):
    """«Найти и заменить» как в Excel: * означает любое количество символов.

    Примеры: найти «_*», заменить на пусто — удаляет «_» и всё после него;
    найти «*_» — удаляет всё до последнего «_» включительно. Поиск без учёта
    регистра. Меняются только строковые значения; числа не трогаем.
    """

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        column = config.get("column")
        find = config.get("find")
        replace = config.get("replace") or ""

        if not all([source, column]) or find in (None, ""):
            raise TransformationError("find_replace requires: source, column, find")
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")

        find = str(find)
        # Маска целиком из звёздочек совпадает с чем угодно — просто присваиваем
        replace_all = not find.strip("*")
        pattern = None
        if not replace_all:
            # Excel-маска -> regex: * становится .*, остальное экранируется
            pattern = re.compile(
                ".*".join(re.escape(part) for part in find.split("*")),
                re.IGNORECASE,
            )

        result = []
        for row in data[source]:
            new_row = row.copy()
            value = new_row.get(column)
            if isinstance(value, str):
                if replace_all:
                    new_row[column] = replace
                else:
                    # lambda, чтобы \ в строке замены не считались regex-ссылками
                    new_row[column] = pattern.sub(lambda _: replace, value)
            result.append(new_row)

        data[source] = result
        return data


class ColumnsTransformation(BaseTransformation):
    """Порядок колонок: перечисленные идут первыми, остальные — следом
    в исходном порядке. Ничего не удаляется."""

    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        order = config.get("columns") or []

        if not source or not order:
            raise TransformationError("columns requires: source, columns")
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")

        result = []
        for row in data[source]:
            new_row = {key: row[key] for key in order if key in row}
            for key, value in row.items():
                if key not in new_row:
                    new_row[key] = value
            result.append(new_row)

        data[source] = result
        return data


class SortTransformation(BaseTransformation):
    """Sort data by columns."""
    
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        source = config.get("source")
        column = config.get("column")
        descending = config.get("descending", False)
        
        if not all([source, column]):
            raise TransformationError("sort requires: source, column")
        
        if source not in data:
            raise TransformationError(f"Source '{source}' not found")
        
        result = sorted(
            data[source],
            key=lambda x: x.get(column, ""),
            reverse=descending
        )
        
        data[source] = result
        return data


# Registry of transformation types
TRANSFORMATIONS = {
    "extract": ExtractTransformation(),
    "group_by": GroupByTransformation(),
    "join": JoinTransformation(),
    "rename": RenameTransformation(),
    "filter": FilterTransformation(),
    "calculate": CalculateTransformation(),
    "sort": SortTransformation(),
    "find_replace": FindReplaceTransformation(),
    "merge_rows": MergeRowsTransformation(),
    "columns": ColumnsTransformation(),
}


class TransformationPipeline:
    """Pipeline for applying multiple transformations."""
    
    def __init__(self, transformations: List[Dict[str, Any]]):
        self.transformations = transformations
    
    def run(self, data: Dict[str, List[Dict]]) -> Dict[str, List[Dict]]:
        """Run all transformations in sequence."""
        result = data.copy()
        
        for i, config in enumerate(self.transformations):
            transform_type = config.get("type")
            
            if transform_type not in TRANSFORMATIONS:
                raise TransformationError(f"Unknown transformation type: {transform_type}")
            
            try:
                transformation = TRANSFORMATIONS[transform_type]
                result = transformation.transform(result, config)
            except TransformationError:
                raise
            except Exception as e:
                raise TransformationError(f"Transformation {i+1} ({transform_type}) failed: {e}")
        
        return result
