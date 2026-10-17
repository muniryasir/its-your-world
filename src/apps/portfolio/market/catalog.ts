// The market catalog: every asset a user can invest in.
//
// Names and descriptions are real; prices are DEMO DATA (see prices.ts).
// This module is the single source for market data. When live prices or an
// admin panel arrive, only market/ changes; pages and operations stay as they are.
import type { AssetClassId } from "../assetClasses";

export type AssetDef = {
  symbol: string;
  name: string;
  assetClass: AssetClassId;
  /** What one unit is, e.g. "barrel", "troy ounce", "share", "coin". */
  unit: string;
  /** Anchor price the simulation moves around. */
  basePrice: number;
  /** Typical daily move (standard deviation of daily log returns). */
  volatility: number;
  /** Decimals shown and stored for the price. */
  decimals: number;
  about: string;
  /** Fixed facts shown on the detail page. */
  facts: [label: string, value: string][];
  /** Shares outstanding / circulating supply; market cap = supply × price. */
  supply?: { label: string; amount: number };
};

const oil = (
  symbol: string, name: string, unit: string, basePrice: number, volatility: number,
  about: string, facts: [string, string][],
): AssetDef => ({ symbol, name, assetClass: "oil", unit, basePrice, volatility, decimals: 2, about, facts });

const crypto = (
  symbol: string, name: string, basePrice: number, volatility: number, decimals: number,
  supply: number, about: string, facts: [string, string][],
): AssetDef => ({
  symbol, name, assetClass: "crypto", unit: "coin", basePrice, volatility, decimals, about, facts,
  supply: { label: "Circulating supply", amount: supply },
});

const stock = (
  symbol: string, name: string, basePrice: number, volatility: number, sharesB: number,
  about: string, facts: [string, string][],
): AssetDef => ({
  symbol, name, assetClass: "stocks", unit: "share", basePrice, volatility, decimals: 2, about, facts,
  supply: { label: "Shares outstanding", amount: sharesB * 1e9 },
});

const metal = (
  symbol: string, name: string, unit: string, basePrice: number, volatility: number,
  about: string, facts: [string, string][],
): AssetDef => ({ symbol, name, assetClass: "metals", unit, basePrice, volatility, decimals: 2, about, facts });

export const ASSETS: AssetDef[] = [
  // ---- Oil & Energy -------------------------------------------------------
  oil("WTI", "WTI Crude", "barrel", 68, 0.021,
    "West Texas Intermediate is the main US crude benchmark, priced at Cushing, Oklahoma. It's light and sweet, which makes it easy to refine into gasoline.",
    [["Benchmark", "United States"], ["Grade", "Light sweet"], ["API gravity", "39.6°"], ["Sulfur", "0.24%"]]),
  oil("BRENT", "Brent Crude", "barrel", 72, 0.02,
    "Brent is the global crude benchmark, based on North Sea oil. Around two thirds of the world's traded oil is priced against it.",
    [["Benchmark", "North Sea"], ["Grade", "Light sweet"], ["API gravity", "38.3°"], ["Sulfur", "0.37%"]]),
  oil("DUBAI", "Dubai / Oman", "barrel", 71, 0.019,
    "The Dubai/Oman benchmark prices Middle Eastern crude sold to Asia. It's heavier and more sulfurous than Brent or WTI.",
    [["Benchmark", "Middle East → Asia"], ["Grade", "Medium sour"], ["API gravity", "31°"], ["Sulfur", "2.0%"]]),
  oil("MURBAN", "Murban Crude", "barrel", 73, 0.019,
    "Murban is Abu Dhabi's flagship light crude, traded on ICE Futures Abu Dhabi. It's a growing benchmark for Gulf oil.",
    [["Benchmark", "Abu Dhabi"], ["Grade", "Light sour"], ["API gravity", "40.2°"], ["Sulfur", "0.79%"]]),
  oil("OPEC", "OPEC Basket", "barrel", 71.5, 0.017,
    "The OPEC Reference Basket is the average price of crude grades exported by OPEC members. It's a reference price, not a traded contract.",
    [["Benchmark", "OPEC members"], ["Grade", "Blend of member grades"], ["Grades in basket", "13"], ["Published by", "OPEC"]]),
  oil("URALS", "Urals Crude", "barrel", 60, 0.023,
    "Urals is Russia's main export blend, a mix of heavy sour and light crude. It usually trades at a discount to Brent.",
    [["Benchmark", "Russia"], ["Grade", "Medium sour"], ["API gravity", "31.7°"], ["Sulfur", "1.35%"]]),
  oil("WCS", "Western Canadian Select", "barrel", 56, 0.024,
    "WCS is a heavy blend from Alberta's oil sands. It trades at a discount to WTI because it costs more to refine and transport.",
    [["Benchmark", "Canada"], ["Grade", "Heavy sour"], ["API gravity", "20.5°"], ["Sulfur", "3.5%"]]),
  oil("NG", "Natural Gas (Henry Hub)", "MMBtu", 3.2, 0.035,
    "Henry Hub in Louisiana is the pricing point for US natural gas futures. Prices swing with weather, storage and LNG exports.",
    [["Benchmark", "United States"], ["Unit", "Million British thermal units"], ["Delivery point", "Erath, Louisiana"], ["Seasonality", "High in winter"]]),
  oil("HO", "Heating Oil", "gallon", 2.35, 0.022,
    "NY Harbor ULSD (ultra-low-sulfur diesel) is the benchmark for heating oil and diesel in the US.",
    [["Benchmark", "New York Harbor"], ["Product", "Ultra-low-sulfur diesel"], ["Unit", "US gallon"], ["Seasonality", "High in winter"]]),
  oil("RB", "RBOB Gasoline", "gallon", 2.15, 0.024,
    "RBOB is the benchmark for US gasoline, delivered in New York Harbor. It tracks crude but has its own summer driving season.",
    [["Benchmark", "New York Harbor"], ["Product", "Reformulated gasoline blendstock"], ["Unit", "US gallon"], ["Seasonality", "High in summer"]]),

  // ---- Crypto -------------------------------------------------------------
  crypto("BTC", "Bitcoin", 98000, 0.03, 2, 19.9e6,
    "Bitcoin is the first and largest cryptocurrency, launched in 2009. Its supply is capped at 21 million coins.",
    [["Launched", "2009"], ["Consensus", "Proof of work"], ["Max supply", "21,000,000"]]),
  crypto("ETH", "Ethereum", 3400, 0.036, 2, 120.5e6,
    "Ethereum is a programmable blockchain for smart contracts and apps. Ether (ETH) pays for transactions on it.",
    [["Launched", "2015"], ["Consensus", "Proof of stake"], ["Max supply", "No cap"]]),
  crypto("SOL", "Solana", 180, 0.045, 2, 520e6,
    "Solana is a fast, low-fee blockchain popular for trading and consumer apps.",
    [["Launched", "2020"], ["Consensus", "Proof of stake + proof of history"], ["Max supply", "No cap"]]),
  crypto("BNB", "BNB", 640, 0.028, 2, 145e6,
    "BNB is the native coin of BNB Chain, created by the Binance exchange. It's used for fees and trading discounts.",
    [["Launched", "2017"], ["Consensus", "Proof of staked authority"], ["Max supply", "200,000,000"]]),
  crypto("XRP", "XRP", 2.3, 0.042, 4, 59e9,
    "XRP is the coin of the XRP Ledger, designed for fast cross-border payments.",
    [["Launched", "2012"], ["Consensus", "XRP Ledger consensus"], ["Max supply", "100,000,000,000"]]),
  crypto("ADA", "Cardano", 0.75, 0.045, 4, 36e9,
    "Cardano is a proof-of-stake blockchain built on peer-reviewed research.",
    [["Launched", "2017"], ["Consensus", "Proof of stake (Ouroboros)"], ["Max supply", "45,000,000,000"]]),
  crypto("DOGE", "Dogecoin", 0.21, 0.055, 4, 148e9,
    "Dogecoin started in 2013 as a joke based on a meme and became one of the most traded coins.",
    [["Launched", "2013"], ["Consensus", "Proof of work"], ["Max supply", "No cap"]]),
  crypto("AVAX", "Avalanche", 32, 0.048, 2, 420e6,
    "Avalanche is a smart-contract platform that lets projects launch their own connected blockchains.",
    [["Launched", "2020"], ["Consensus", "Proof of stake (Avalanche)"], ["Max supply", "720,000,000"]]),
  crypto("DOT", "Polkadot", 6.5, 0.046, 2, 1.5e9,
    "Polkadot connects specialized blockchains so they can share security and exchange data.",
    [["Launched", "2020"], ["Consensus", "Nominated proof of stake"], ["Max supply", "No cap"]]),
  crypto("LINK", "Chainlink", 18, 0.047, 2, 650e6,
    "Chainlink is an oracle network that feeds real-world data, like prices, into smart contracts.",
    [["Launched", "2017"], ["Network", "Ethereum (ERC-20)"], ["Max supply", "1,000,000,000"]]),

  // ---- US Stocks ----------------------------------------------------------
  stock("AAPL", "Apple Inc.", 230, 0.016, 15.0,
    "Apple designs the iPhone, Mac, iPad and Apple Watch, and earns a growing share of revenue from services.",
    [["Exchange", "NASDAQ"], ["Sector", "Technology"], ["P/E ratio", "35.1"], ["Dividend yield", "0.44%"]]),
  stock("MSFT", "Microsoft Corp.", 450, 0.015, 7.43,
    "Microsoft makes Windows and Office and runs Azure, one of the largest cloud platforms.",
    [["Exchange", "NASDAQ"], ["Sector", "Technology"], ["P/E ratio", "36.4"], ["Dividend yield", "0.72%"]]),
  stock("NVDA", "NVIDIA Corp.", 140, 0.03, 24.4,
    "NVIDIA designs GPUs that power gaming and most of the world's AI training.",
    [["Exchange", "NASDAQ"], ["Sector", "Semiconductors"], ["P/E ratio", "52.8"], ["Dividend yield", "0.03%"]]),
  stock("AMZN", "Amazon.com Inc.", 210, 0.019, 10.6,
    "Amazon runs the largest US online store and Amazon Web Services (AWS), the biggest cloud provider.",
    [["Exchange", "NASDAQ"], ["Sector", "Consumer / Cloud"], ["P/E ratio", "44.0"], ["Dividend yield", "—"]]),
  stock("GOOGL", "Alphabet Inc.", 185, 0.018, 12.2,
    "Alphabet is Google's parent company: Search, YouTube, Android and Google Cloud.",
    [["Exchange", "NASDAQ"], ["Sector", "Communication"], ["P/E ratio", "23.5"], ["Dividend yield", "0.45%"]]),
  stock("META", "Meta Platforms Inc.", 620, 0.022, 2.52,
    "Meta owns Facebook, Instagram and WhatsApp, and invests heavily in AI and VR.",
    [["Exchange", "NASDAQ"], ["Sector", "Communication"], ["P/E ratio", "27.2"], ["Dividend yield", "0.33%"]]),
  stock("TSLA", "Tesla Inc.", 300, 0.035, 3.22,
    "Tesla makes electric cars, batteries and solar products.",
    [["Exchange", "NASDAQ"], ["Sector", "Automotive"], ["P/E ratio", "98.7"], ["Dividend yield", "—"]]),
  stock("BRK.B", "Berkshire Hathaway B", 480, 0.011, 2.16,
    "Berkshire Hathaway is a conglomerate that owns insurers, railroads and utilities, plus large stakes in public companies.",
    [["Exchange", "NYSE"], ["Sector", "Financials"], ["P/E ratio", "12.8"], ["Dividend yield", "—"]]),
  stock("JPM", "JPMorgan Chase & Co.", 260, 0.015, 2.8,
    "JPMorgan Chase is the largest US bank by assets, spanning consumer banking, investment banking and asset management.",
    [["Exchange", "NYSE"], ["Sector", "Financials"], ["P/E ratio", "13.1"], ["Dividend yield", "1.95%"]]),
  stock("V", "Visa Inc.", 340, 0.013, 1.95,
    "Visa runs one of the world's largest card payment networks.",
    [["Exchange", "NYSE"], ["Sector", "Financials"], ["P/E ratio", "31.6"], ["Dividend yield", "0.70%"]]),

  // ---- Metals -------------------------------------------------------------
  metal("XAU", "Gold", "troy ounce", 3300, 0.009,
    "Gold is the classic safe-haven asset, held by central banks and investors as a store of value.",
    [["Type", "Precious"], ["Purity standard", "99.5% (London Good Delivery)"], ["Main use", "Investment, jewelry"]]),
  metal("XAG", "Silver", "troy ounce", 38, 0.018,
    "Silver is both a precious metal and an industrial one, used in solar panels and electronics.",
    [["Type", "Precious"], ["Purity standard", "99.9%"], ["Main use", "Industry, investment, jewelry"]]),
  metal("XPT", "Platinum", "troy ounce", 1300, 0.017,
    "Platinum is rarer than gold and is used mostly in catalytic converters and jewelry.",
    [["Type", "Precious"], ["Purity standard", "99.95%"], ["Main use", "Autocatalysts, jewelry"]]),
  metal("XPD", "Palladium", "troy ounce", 1100, 0.022,
    "Palladium is used mainly in gasoline car catalytic converters; most supply comes from Russia and South Africa.",
    [["Type", "Precious"], ["Purity standard", "99.95%"], ["Main use", "Autocatalysts"]]),
  metal("CU", "Copper", "pound", 4.6, 0.014,
    "Copper is the backbone of wiring and power grids. Its price is often read as a signal of global economic health.",
    [["Type", "Industrial"], ["Exchange", "COMEX / LME"], ["Main use", "Electrical wiring, construction"]]),
  metal("AL", "Aluminium", "tonne", 2600, 0.012,
    "Aluminium is light and corrosion-resistant, used in cars, planes, packaging and buildings.",
    [["Type", "Industrial"], ["Exchange", "LME"], ["Main use", "Transport, packaging"]]),
  metal("NI", "Nickel", "tonne", 15500, 0.018,
    "Nickel goes into stainless steel and, increasingly, electric-vehicle batteries.",
    [["Type", "Industrial"], ["Exchange", "LME"], ["Main use", "Stainless steel, batteries"]]),
  metal("ZN", "Zinc", "tonne", 2750, 0.014,
    "Zinc is mainly used to galvanize steel so it doesn't rust.",
    [["Type", "Industrial"], ["Exchange", "LME"], ["Main use", "Galvanizing steel"]]),
  metal("PB", "Lead", "tonne", 2000, 0.012,
    "Lead is used mostly in car batteries, and most of it is recycled.",
    [["Type", "Industrial"], ["Exchange", "LME"], ["Main use", "Lead-acid batteries"]]),
  metal("SN", "Tin", "tonne", 33000, 0.017,
    "Tin is used in solder for electronics, which makes it sensitive to the chip industry.",
    [["Type", "Industrial"], ["Exchange", "LME"], ["Main use", "Electronics solder"]]),
];

const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

export function findAsset(symbol: unknown): AssetDef | undefined {
  return typeof symbol === "string" ? BY_SYMBOL.get(symbol.trim().toUpperCase()) : undefined;
}
