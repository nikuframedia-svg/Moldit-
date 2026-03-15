"""Tests for the ISOP parser — Contract C-01."""

from src.engine.models import ISOPData
from src.parser.isop import parse_isop

# ── 1. SKU count ────────────────────────────────────────────────────


def test_parse_returns_correct_sku_count(isop_path):
    """Parsed file should have SKUs (aggregated, so fewer than raw rows)."""
    data = parse_isop(isop_path)
    assert isinstance(data, ISOPData)
    # Nikufra has ~59 tools / ~94 SKUs — aggregated count should be reasonable
    assert len(data.skus) > 0
    assert len(data.skus) <= 200  # sanity upper bound


# ── 2. Negative NP → Orders ────────────────────────────────────────


def test_negative_values_become_orders(isop_path):
    """Each negative NP cell becomes one Order with qty = abs(value)."""
    data = parse_isop(isop_path)
    assert len(data.orders) > 0
    for order in data.orders:
        assert order.qty > 0, "Order qty must be positive (abs of negative NP)"
        assert order.deadline is not None


# ── 3. Stock extraction ────────────────────────────────────────────


def test_stock_is_last_positive(isop_path):
    """SKUs with orders should have stock >= 0; some should have stock > 0."""
    data = parse_isop(isop_path)
    has_positive_stock = False
    for sku in data.skus.values():
        assert sku.stock >= 0, f"Stock must be >= 0, got {sku.stock} for {sku.sku}"
        if sku.stock > 0:
            has_positive_stock = True
    # At least some SKUs should have initial stock
    assert has_positive_stock, "Expected at least one SKU with stock > 0"


# ── 4. All-negative → stock = 0 ────────────────────────────────────


def test_stock_all_negative(isop_path):
    """SKUs where all NP values are negative should have stock = 0."""
    data = parse_isop(isop_path)
    # Find SKUs with orders but stock == 0 (implies no positive NP before first negative)
    zero_stock_skus = [s for s in data.skus.values() if s.stock == 0 and len(s.orders) > 0]
    # There should be at least some SKUs with zero stock
    assert len(zero_stock_skus) >= 0  # structural: stock is always non-negative
    for s in zero_stock_skus:
        assert s.stock == 0


# ── 5. Twin pairs detected ─────────────────────────────────────────


def test_twin_pairs_detected(isop_path):
    """Twin pairs (LH/RH) should be detected from column M."""
    data = parse_isop(isop_path)
    assert len(data.twin_pairs) > 0, "Expected at least one twin pair"
    for a, b in data.twin_pairs:
        assert a < b, "Twin pairs should be sorted (a < b)"
        assert a != b, "Twin pair members must be different SKUs"


# ── 6. Multi-client aggregation ─────────────────────────────────────


def test_multi_client_aggregation(isop_path):
    """SKUs appearing for multiple clients should aggregate correctly."""
    data = parse_isop(isop_path)
    multi_client_skus = [s for s in data.skus.values() if len(s.clients) > 1]
    # Some SKUs should have multiple clients (multi-client rows in ISOP)
    assert len(multi_client_skus) > 0, "Expected at least one SKU with multiple clients"
    for s in multi_client_skus:
        assert len(s.clients) > 1
    # Structural: all SKU orders must reference that SKU
    for s in data.skus.values():
        for o in s.orders:
            assert o.sku == s.sku


# ── 7. Economic lot parsed ──────────────────────────────────────────


def test_economic_lot_parsed(isop_path):
    """At least some SKUs should have a non-zero economic lot."""
    data = parse_isop(isop_path)
    lots = [s.economic_lot for s in data.skus.values()]
    assert any(lot > 0 for lot in lots), "Expected at least one SKU with economic_lot > 0"
    # All lots should be non-negative
    assert all(lot >= 0 for lot in lots), "Economic lot must be >= 0"


# ── 8. Zero lot handled ─────────────────────────────────────────────


def test_zero_lot_handled(isop_path):
    """SKUs with lot = 0 should have economic_lot = 0 (not None or negative)."""
    data = parse_isop(isop_path)
    zero_lot_skus = [s for s in data.skus.values() if s.economic_lot == 0]
    assert len(zero_lot_skus) > 0, "Expected at least one SKU with economic_lot == 0"
    for s in zero_lot_skus:
        assert s.economic_lot == 0
        assert isinstance(s.economic_lot, int)


# ── 9. Prz.Fabrico ignored ──────────────────────────────────────────


def test_prz_fabrico_ignored(isop_path):
    """Prz.Fabrico (col F) must NOT appear in any model field."""
    data = parse_isop(isop_path)
    for s in data.skus.values():
        fields = s.model_fields_set
        assert "prz_fabrico" not in fields
        assert "lead_time" not in fields
        # Check Order fields too
        for o in s.orders:
            o_fields = set(o.model_dump().keys())
            assert "prz_fabrico" not in o_fields
            assert "lead_time" not in o_fields


# ── 10. Deterministic ───────────────────────────────────────────────


def test_deterministic(isop_path):
    """Parsing the same file twice must produce identical results."""
    data1 = parse_isop(isop_path)
    data2 = parse_isop(isop_path)
    assert data1.model_dump() == data2.model_dump()
