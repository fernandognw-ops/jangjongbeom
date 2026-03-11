-- 입출고·현재품목 테이블 인덱스 (2025+2026 데이터 대량 조회 속도 최적화)
-- 이미 존재하면 무시됨 (IF NOT EXISTS)

-- inventory_inbound (sales_channel 컬럼 없음)
CREATE INDEX IF NOT EXISTS idx_inv_inbound_date ON inventory_inbound(inbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_product ON inventory_inbound(product_code);

-- inventory_outbound
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_channel ON inventory_outbound(sales_channel);

-- inventory_current_products
CREATE INDEX IF NOT EXISTS idx_inv_current_product ON inventory_current_products(product_code);
