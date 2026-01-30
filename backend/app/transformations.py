"""Data transformation pipeline for reports."""
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
                
                if agg_func == "sum":
                    new_row[col] = sum(values)
                elif agg_func == "avg":
                    new_row[col] = sum(values) / len(values) if values else 0
                elif agg_func == "count":
                    new_row[col] = len(values)
                elif agg_func == "min":
                    new_row[col] = min(values) if values else 0
                elif agg_func == "max":
                    new_row[col] = max(values) if values else 0
                elif agg_func == "first":
                    new_row[col] = values[0] if values else None
                elif agg_func == "last":
                    new_row[col] = values[-1] if values else None
                else:
                    raise TransformationError(f"Unknown aggregation function: {agg_func}")
            
            result.append(new_row)
        
        data[source] = result
        return data


class JoinTransformation(BaseTransformation):
    """Join two data sources."""
    
    def transform(self, data: Dict[str, List[Dict]], config: Dict[str, Any]) -> Dict[str, List[Dict]]:
        left_source = config.get("left")
        right_source = config.get("right")
        on_column = config.get("on")
        how = config.get("how", "inner")  # inner, left, right, outer
        output_source = config.get("output", left_source)
        
        if not all([left_source, right_source, on_column]):
            raise TransformationError("join requires: left, right, on")
        
        if left_source not in data:
            raise TransformationError(f"Left source '{left_source}' not found")
        if right_source not in data:
            raise TransformationError(f"Right source '{right_source}' not found")
        
        left_data = data[left_source]
        right_data = data[right_source]
        
        # Build index for right data
        right_index = defaultdict(list)
        for row in right_data:
            key = row.get(on_column, "")
            right_index[key].append(row)
        
        result = []
        used_right_keys = set()
        
        for left_row in left_data:
            key = left_row.get(on_column, "")
            right_rows = right_index.get(key, [])
            
            if right_rows:
                used_right_keys.add(key)
                for right_row in right_rows:
                    merged = {**left_row}
                    for k, v in right_row.items():
                        if k != on_column:  # Don't duplicate join column
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
        
        result = []
        for row in data[source]:
            new_row = row.copy()
            try:
                # Simple expression evaluation (only basic math operations)
                # Parse formula like "cost / clicks"
                expr = formula
                for col in row.keys():
                    if col in expr:
                        val = row.get(col, 0)
                        if val is None:
                            val = 0
                        expr = expr.replace(col, str(float(val)))
                
                # Safe evaluation of math expression
                result_value = eval(expr, {"__builtins__": {}}, {})
                new_row[output_column] = round(result_value, 4) if isinstance(result_value, float) else result_value
            except (ZeroDivisionError, ValueError, TypeError):
                new_row[output_column] = None
            
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
