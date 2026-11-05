-- Flipkart prices are entered by hand (live scraping is not possible and there
-- is no Affiliate API access), so a listing records where its price came from
-- and when the user entered it.
ALTER TABLE product_listings
  ADD COLUMN source ENUM('live','manual') NOT NULL DEFAULT 'live' AFTER availability,
  ADD COLUMN entered_at DATETIME NULL AFTER source;
