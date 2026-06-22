export function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function finiteOr(value, fallback = 0) {
  const number = finiteNumber(value);
  return number === null ? fallback : number;
}

export function fixed(value, digits = 1, suffix = "", fallback = "N/A") {
  const number = finiteNumber(value);
  return number === null ? fallback : `${number.toFixed(digits)}${suffix}`;
}

export function signedPercent(value, digits = 1, fallback = "N/A") {
  const number = finiteNumber(value);
  if (number === null) return fallback;
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

export function compactNumber(value, fallback = "-") {
  const number = finiteNumber(value);
  if (number === null) return fallback;
  if (Math.abs(number) >= 1e12) return `${(number / 1e12).toFixed(1)}T`;
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return number.toFixed(0);
}

export function dividendYield(lastDividend, price) {
  const dividend = finiteNumber(lastDividend);
  const currentPrice = finiteNumber(price);
  if (dividend === null || currentPrice === null || currentPrice <= 0) return null;
  if (dividend <= 0) return 0;
  return (dividend / currentPrice) * 100;
}
