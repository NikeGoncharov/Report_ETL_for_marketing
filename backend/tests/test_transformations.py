"""Unit tests for data transformation pipeline."""
import pytest

from app.transformations import (
    TransformationPipeline,
    TransformationError,
    ExtractTransformation,
    GroupByTransformation,
    JoinTransformation,
    RenameTransformation,
    FilterTransformation,
    CalculateTransformation,
    SortTransformation,
)


class TestExtractTransformation:
    """Tests for extract transformation."""
    
    def test_extract_basic(self):
        """Should extract pattern from string."""
        transform = ExtractTransformation()
        data = {
            "source": [
                {"name": "campaign_123_test", "value": 100},
                {"name": "campaign_456_prod", "value": 200},
            ]
        }
        config = {
            "source": "source",
            "column": "name",
            "pattern": r"campaign_(\d+)_",
            "output_column": "campaign_id"
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["campaign_id"] == "123"
        assert result["source"][1]["campaign_id"] == "456"
    
    def test_extract_no_match(self):
        """Should keep original value when no match."""
        transform = ExtractTransformation()
        data = {
            "source": [
                {"name": "no_match_here", "value": 100},
            ]
        }
        config = {
            "source": "source",
            "column": "name",
            "pattern": r"campaign_(\d+)_",
            "output_column": "campaign_id"
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["campaign_id"] == "no_match_here"
    
    def test_extract_missing_source(self):
        """Should raise error for missing source."""
        transform = ExtractTransformation()
        data = {"other": [{"name": "test"}]}
        config = {
            "source": "nonexistent",
            "column": "name",
            "pattern": r"(\d+)",
            "output_column": "number"
        }
        
        with pytest.raises(TransformationError, match="Source.*not found"):
            transform.transform(data, config)
    
    def test_extract_invalid_regex(self):
        """Should raise error for invalid regex pattern."""
        transform = ExtractTransformation()
        data = {"source": [{"name": "test"}]}
        config = {
            "source": "source",
            "column": "name",
            "pattern": r"[invalid",  # Invalid regex
            "output_column": "result"
        }
        
        with pytest.raises(TransformationError, match="Invalid regex"):
            transform.transform(data, config)
    
    def test_extract_missing_config(self):
        """Should raise error for missing required config."""
        transform = ExtractTransformation()
        data = {"source": [{"name": "test"}]}
        config = {"source": "source"}  # Missing other required fields
        
        with pytest.raises(TransformationError, match="requires"):
            transform.transform(data, config)


class TestGroupByTransformation:
    """Tests for group_by transformation."""
    
    def test_group_by_sum(self):
        """Should group and sum values."""
        transform = GroupByTransformation()
        data = {
            "source": [
                {"category": "A", "value": 10},
                {"category": "A", "value": 20},
                {"category": "B", "value": 30},
            ]
        }
        config = {
            "source": "source",
            "columns": ["category"],
            "aggregations": {"value": "sum"}
        }
        
        result = transform.transform(data, config)
        
        result_by_cat = {r["category"]: r["value"] for r in result["source"]}
        assert result_by_cat["A"] == 30
        assert result_by_cat["B"] == 30
    
    def test_group_by_avg(self):
        """Should calculate average."""
        transform = GroupByTransformation()
        data = {
            "source": [
                {"category": "A", "value": 10},
                {"category": "A", "value": 20},
                {"category": "A", "value": 30},
            ]
        }
        config = {
            "source": "source",
            "columns": ["category"],
            "aggregations": {"value": "avg"}
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["value"] == 20.0
    
    def test_group_by_count(self):
        """Should count rows."""
        transform = GroupByTransformation()
        data = {
            "source": [
                {"category": "A", "value": 1},
                {"category": "A", "value": 2},
                {"category": "B", "value": 3},
            ]
        }
        config = {
            "source": "source",
            "columns": ["category"],
            "aggregations": {"value": "count"}
        }
        
        result = transform.transform(data, config)
        
        result_by_cat = {r["category"]: r["value"] for r in result["source"]}
        assert result_by_cat["A"] == 2
        assert result_by_cat["B"] == 1
    
    def test_group_by_min_max(self):
        """Should find min and max values."""
        transform = GroupByTransformation()
        data = {
            "source": [
                {"category": "A", "min_val": 5, "max_val": 5},
                {"category": "A", "min_val": 1, "max_val": 10},
                {"category": "A", "min_val": 3, "max_val": 7},
            ]
        }
        config = {
            "source": "source",
            "columns": ["category"],
            "aggregations": {"min_val": "min", "max_val": "max"}
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["min_val"] == 1
        assert result["source"][0]["max_val"] == 10
    
    def test_group_by_multiple_columns(self):
        """Should group by multiple columns."""
        transform = GroupByTransformation()
        data = {
            "source": [
                {"cat1": "A", "cat2": "X", "value": 10},
                {"cat1": "A", "cat2": "X", "value": 20},
                {"cat1": "A", "cat2": "Y", "value": 30},
            ]
        }
        config = {
            "source": "source",
            "columns": ["cat1", "cat2"],
            "aggregations": {"value": "sum"}
        }
        
        result = transform.transform(data, config)
        
        assert len(result["source"]) == 2
    
    def test_group_by_unknown_aggregation(self):
        """Should raise error for unknown aggregation."""
        transform = GroupByTransformation()
        data = {"source": [{"category": "A", "value": 10}]}
        config = {
            "source": "source",
            "columns": ["category"],
            "aggregations": {"value": "unknown_func"}
        }
        
        with pytest.raises(TransformationError, match="Unknown aggregation"):
            transform.transform(data, config)


class TestJoinTransformation:
    """Tests for join transformation."""
    
    def test_inner_join(self):
        """Should perform inner join."""
        transform = JoinTransformation()
        data = {
            "left": [
                {"id": 1, "name": "A"},
                {"id": 2, "name": "B"},
                {"id": 3, "name": "C"},
            ],
            "right": [
                {"id": 1, "value": 100},
                {"id": 2, "value": 200},
            ]
        }
        config = {
            "left": "left",
            "right": "right",
            "on": "id",
            "how": "inner"
        }
        
        result = transform.transform(data, config)
        
        assert len(result["left"]) == 2  # Only matched rows
        assert result["left"][0]["value"] == 100
        assert result["left"][1]["value"] == 200
    
    def test_left_join(self):
        """Should perform left join."""
        transform = JoinTransformation()
        data = {
            "left": [
                {"id": 1, "name": "A"},
                {"id": 2, "name": "B"},
                {"id": 3, "name": "C"},
            ],
            "right": [
                {"id": 1, "value": 100},
            ]
        }
        config = {
            "left": "left",
            "right": "right",
            "on": "id",
            "how": "left"
        }
        
        result = transform.transform(data, config)
        
        assert len(result["left"]) == 3  # All left rows
        # Only first row has value from right
        matched = [r for r in result["left"] if "value" in r]
        assert len(matched) == 1
    
    def test_join_column_conflict(self):
        """Should handle column name conflicts."""
        transform = JoinTransformation()
        data = {
            "left": [
                {"id": 1, "value": "left_value"},
            ],
            "right": [
                {"id": 1, "value": "right_value"},
            ]
        }
        config = {
            "left": "left",
            "right": "right",
            "on": "id",
            "how": "inner"
        }
        
        result = transform.transform(data, config)
        
        row = result["left"][0]
        assert row["value"] == "left_value"
        assert row["right_value"] == "right_value"
    
    def test_join_missing_source(self):
        """Should raise error for missing source."""
        transform = JoinTransformation()
        data = {"left": [{"id": 1}]}
        config = {
            "left": "left",
            "right": "nonexistent",
            "on": "id"
        }
        
        with pytest.raises(TransformationError, match="not found"):
            transform.transform(data, config)


class TestRenameTransformation:
    """Tests for rename transformation."""
    
    def test_rename_columns(self):
        """Should rename columns."""
        transform = RenameTransformation()
        data = {
            "source": [
                {"old_name": "value1", "keep": "unchanged"},
            ]
        }
        config = {
            "source": "source",
            "mapping": {"old_name": "new_name"}
        }
        
        result = transform.transform(data, config)
        
        assert "new_name" in result["source"][0]
        assert "old_name" not in result["source"][0]
        assert result["source"][0]["keep"] == "unchanged"
    
    def test_rename_multiple(self):
        """Should rename multiple columns."""
        transform = RenameTransformation()
        data = {
            "source": [
                {"a": 1, "b": 2, "c": 3},
            ]
        }
        config = {
            "source": "source",
            "mapping": {"a": "alpha", "b": "beta"}
        }
        
        result = transform.transform(data, config)
        row = result["source"][0]
        
        assert row["alpha"] == 1
        assert row["beta"] == 2
        assert row["c"] == 3


class TestFilterTransformation:
    """Tests for filter transformation."""
    
    def test_filter_eq(self):
        """Should filter with equality."""
        transform = FilterTransformation()
        data = {
            "source": [
                {"status": "active", "value": 1},
                {"status": "inactive", "value": 2},
                {"status": "active", "value": 3},
            ]
        }
        config = {
            "source": "source",
            "column": "status",
            "operator": "eq",
            "value": "active"
        }
        
        result = transform.transform(data, config)
        
        assert len(result["source"]) == 2
        assert all(r["status"] == "active" for r in result["source"])
    
    def test_filter_gt(self):
        """Should filter with greater than."""
        transform = FilterTransformation()
        data = {
            "source": [
                {"value": 10},
                {"value": 20},
                {"value": 30},
            ]
        }
        config = {
            "source": "source",
            "column": "value",
            "operator": "gt",
            "value": 15
        }
        
        result = transform.transform(data, config)
        
        assert len(result["source"]) == 2
        assert all(r["value"] > 15 for r in result["source"])
    
    def test_filter_contains(self):
        """Should filter with contains."""
        transform = FilterTransformation()
        data = {
            "source": [
                {"name": "hello world"},
                {"name": "foo bar"},
                {"name": "world peace"},
            ]
        }
        config = {
            "source": "source",
            "column": "name",
            "operator": "contains",
            "value": "world"
        }
        
        result = transform.transform(data, config)
        
        assert len(result["source"]) == 2
    
    def test_filter_not_null(self):
        """Should filter out null values."""
        transform = FilterTransformation()
        data = {
            "source": [
                {"value": 10},
                {"value": None},
                {"value": ""},
                {"value": 20},
            ]
        }
        config = {
            "source": "source",
            "column": "value",
            "operator": "not_null"
        }
        
        result = transform.transform(data, config)
        
        assert len(result["source"]) == 2
    
    def test_filter_unknown_operator(self):
        """Should raise error for unknown operator."""
        transform = FilterTransformation()
        data = {"source": [{"value": 10}]}
        config = {
            "source": "source",
            "column": "value",
            "operator": "unknown_op",
            "value": 5
        }
        
        with pytest.raises(TransformationError, match="Unknown operator"):
            transform.transform(data, config)


class TestCalculateTransformation:
    """Tests for calculate transformation."""
    
    def test_calculate_division(self):
        """Should calculate division."""
        transform = CalculateTransformation()
        data = {
            "source": [
                {"cost": 100, "clicks": 10},
                {"cost": 200, "clicks": 20},
            ]
        }
        config = {
            "source": "source",
            "output_column": "cpc",
            "formula": "cost / clicks"
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["cpc"] == 10.0
        assert result["source"][1]["cpc"] == 10.0
    
    def test_calculate_complex_formula(self):
        """Should calculate complex formula."""
        transform = CalculateTransformation()
        data = {
            "source": [
                {"a": 10, "b": 5, "c": 2},
            ]
        }
        config = {
            "source": "source",
            "output_column": "result",
            "formula": "(a + b) * c"
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["result"] == 30.0
    
    def test_calculate_division_by_zero(self):
        """Should handle division by zero."""
        transform = CalculateTransformation()
        data = {
            "source": [
                {"cost": 100, "clicks": 0},
            ]
        }
        config = {
            "source": "source",
            "output_column": "cpc",
            "formula": "cost / clicks"
        }
        
        result = transform.transform(data, config)
        
        assert result["source"][0]["cpc"] is None


class TestSortTransformation:
    """Tests for sort transformation."""
    
    def test_sort_ascending(self):
        """Should sort in ascending order."""
        transform = SortTransformation()
        data = {
            "source": [
                {"value": 30},
                {"value": 10},
                {"value": 20},
            ]
        }
        config = {
            "source": "source",
            "column": "value",
            "descending": False
        }
        
        result = transform.transform(data, config)
        
        values = [r["value"] for r in result["source"]]
        assert values == [10, 20, 30]
    
    def test_sort_descending(self):
        """Should sort in descending order."""
        transform = SortTransformation()
        data = {
            "source": [
                {"value": 10},
                {"value": 30},
                {"value": 20},
            ]
        }
        config = {
            "source": "source",
            "column": "value",
            "descending": True
        }
        
        result = transform.transform(data, config)
        
        values = [r["value"] for r in result["source"]]
        assert values == [30, 20, 10]


class TestTransformationPipeline:
    """Tests for the transformation pipeline."""
    
    def test_pipeline_single_transform(self):
        """Should run single transformation."""
        pipeline = TransformationPipeline([
            {"type": "rename", "source": "data", "mapping": {"a": "alpha"}}
        ])
        data = {"data": [{"a": 1}]}
        
        result = pipeline.run(data)
        
        assert "alpha" in result["data"][0]
    
    def test_pipeline_multiple_transforms(self):
        """Should run multiple transformations in sequence."""
        pipeline = TransformationPipeline([
            {"type": "rename", "source": "data", "mapping": {"val": "value"}},
            {"type": "filter", "source": "data", "column": "value", "operator": "gt", "value": 15},
            {"type": "sort", "source": "data", "column": "value", "descending": True}
        ])
        data = {
            "data": [
                {"val": 10},
                {"val": 30},
                {"val": 20},
            ]
        }
        
        result = pipeline.run(data)
        
        assert len(result["data"]) == 2
        assert result["data"][0]["value"] == 30
        assert result["data"][1]["value"] == 20
    
    def test_pipeline_empty(self):
        """Should return data unchanged with no transformations."""
        pipeline = TransformationPipeline([])
        data = {"data": [{"a": 1}]}
        
        result = pipeline.run(data)
        
        assert result["data"][0]["a"] == 1
    
    def test_pipeline_unknown_transform_type(self):
        """Should raise error for unknown transformation type."""
        pipeline = TransformationPipeline([
            {"type": "unknown_transform", "source": "data"}
        ])
        data = {"data": [{"a": 1}]}
        
        with pytest.raises(TransformationError, match="Unknown transformation"):
            pipeline.run(data)
    
    def test_pipeline_transform_error_propagation(self):
        """Should propagate transformation errors."""
        pipeline = TransformationPipeline([
            {"type": "filter", "source": "nonexistent", "column": "a", "operator": "eq", "value": 1}
        ])
        data = {"data": [{"a": 1}]}
        
        with pytest.raises(TransformationError, match="not found"):
            pipeline.run(data)
    
    def test_pipeline_complex_scenario(self):
        """Test realistic data transformation scenario."""
        # Simulate joining Direct campaigns with Metrika UTM data
        pipeline = TransformationPipeline([
            # Extract campaign ID from UTM campaign
            {
                "type": "extract",
                "source": "metrika",
                "column": "utm_campaign",
                "pattern": r"cid(\d+)",
                "output_column": "campaign_id"
            },
            # Join with Direct data
            {
                "type": "join",
                "left": "direct",
                "right": "metrika",
                "on": "campaign_id",
                "how": "left"
            },
            # Calculate CPA
            {
                "type": "calculate",
                "source": "direct",
                "output_column": "cpa",
                "formula": "cost / conversions"
            },
            # Filter only campaigns with conversions
            {
                "type": "filter",
                "source": "direct",
                "column": "conversions",
                "operator": "gt",
                "value": 0
            }
        ])
        
        data = {
            "direct": [
                {"campaign_id": "123", "campaign_name": "Campaign A", "cost": 1000, "conversions": 10},
                {"campaign_id": "456", "campaign_name": "Campaign B", "cost": 500, "conversions": 0},
            ],
            "metrika": [
                {"utm_campaign": "cid123_test", "visits": 100},
                {"utm_campaign": "cid456_test", "visits": 50},
            ]
        }
        
        result = pipeline.run(data)
        
        # Only Campaign A should remain (has conversions)
        assert len(result["direct"]) == 1
        assert result["direct"][0]["campaign_name"] == "Campaign A"
        assert result["direct"][0]["cpa"] == 100.0  # 1000/10
        assert result["direct"][0]["visits"] == 100  # From joined Metrika data
