import type { ChinaRegion } from "./types";

/**
 * Province metadata keyed by the adcodes used in public/china-provinces.json
 * (DataV boundary data). `nameZh` matches the TopoJSON feature names exactly.
 */
export interface ProvinceMeta {
  adcode: number;
  nameZh: string;
  nameEn: string;
  region: ChinaRegion;
}

export const PROVINCES: ProvinceMeta[] = [
  { adcode: 110000, nameZh: "北京市", nameEn: "Beijing", region: "North" },
  { adcode: 120000, nameZh: "天津市", nameEn: "Tianjin", region: "North" },
  { adcode: 130000, nameZh: "河北省", nameEn: "Hebei", region: "North" },
  { adcode: 140000, nameZh: "山西省", nameEn: "Shanxi", region: "North" },
  { adcode: 150000, nameZh: "内蒙古自治区", nameEn: "Inner Mongolia", region: "North" },
  { adcode: 210000, nameZh: "辽宁省", nameEn: "Liaoning", region: "Northeast" },
  { adcode: 220000, nameZh: "吉林省", nameEn: "Jilin", region: "Northeast" },
  { adcode: 230000, nameZh: "黑龙江省", nameEn: "Heilongjiang", region: "Northeast" },
  { adcode: 310000, nameZh: "上海市", nameEn: "Shanghai", region: "East" },
  { adcode: 320000, nameZh: "江苏省", nameEn: "Jiangsu", region: "East" },
  { adcode: 330000, nameZh: "浙江省", nameEn: "Zhejiang", region: "East" },
  { adcode: 340000, nameZh: "安徽省", nameEn: "Anhui", region: "East" },
  { adcode: 350000, nameZh: "福建省", nameEn: "Fujian", region: "South" },
  { adcode: 360000, nameZh: "江西省", nameEn: "Jiangxi", region: "East" },
  { adcode: 370000, nameZh: "山东省", nameEn: "Shandong", region: "East" },
  { adcode: 410000, nameZh: "河南省", nameEn: "Henan", region: "Central" },
  { adcode: 420000, nameZh: "湖北省", nameEn: "Hubei", region: "Central" },
  { adcode: 430000, nameZh: "湖南省", nameEn: "Hunan", region: "Central" },
  { adcode: 440000, nameZh: "广东省", nameEn: "Guangdong", region: "South" },
  { adcode: 450000, nameZh: "广西壮族自治区", nameEn: "Guangxi", region: "South" },
  { adcode: 460000, nameZh: "海南省", nameEn: "Hainan", region: "South" },
  { adcode: 500000, nameZh: "重庆市", nameEn: "Chongqing", region: "Southwest" },
  { adcode: 510000, nameZh: "四川省", nameEn: "Sichuan", region: "Southwest" },
  { adcode: 520000, nameZh: "贵州省", nameEn: "Guizhou", region: "Southwest" },
  { adcode: 530000, nameZh: "云南省", nameEn: "Yunnan", region: "Southwest" },
  { adcode: 540000, nameZh: "西藏自治区", nameEn: "Tibet", region: "Southwest" },
  { adcode: 610000, nameZh: "陕西省", nameEn: "Shaanxi", region: "Northwest" },
  { adcode: 620000, nameZh: "甘肃省", nameEn: "Gansu", region: "Northwest" },
  { adcode: 630000, nameZh: "青海省", nameEn: "Qinghai", region: "Northwest" },
  { adcode: 640000, nameZh: "宁夏回族自治区", nameEn: "Ningxia", region: "Northwest" },
  { adcode: 650000, nameZh: "新疆维吾尔自治区", nameEn: "Xinjiang", region: "Northwest" },
  { adcode: 710000, nameZh: "台湾省", nameEn: "Taiwan", region: "South" },
  { adcode: 810000, nameZh: "香港特别行政区", nameEn: "Hong Kong", region: "South" },
  { adcode: 820000, nameZh: "澳门特别行政区", nameEn: "Macau", region: "South" },
];

const BY_ADCODE = new Map(PROVINCES.map((p) => [p.adcode, p]));

export function provinceByAdcode(adcode: number): ProvinceMeta | undefined {
  return BY_ADCODE.get(adcode);
}

/**
 * Keyword → region lookup for free-text province strings (catalog data uses
 * English names like "Henan" or "Xinjiang Uyghur Autonomous Region").
 */
const REGION_KEYWORDS: [string, ChinaRegion][] = [
  ...PROVINCES.map((p): [string, ChinaRegion] => [p.nameEn.toLowerCase(), p.region]),
  ["xizang", "Southwest"],
];

export function regionForProvinceText(text: string): ChinaRegion | undefined {
  const haystack = text.toLowerCase();
  for (const [key, region] of REGION_KEYWORDS) {
    if (haystack.includes(key)) return region;
  }
  return undefined;
}

/** Display metadata per region: atlas tint + label anchor (lon/lat). */
export const REGION_META: Record<
  ChinaRegion,
  { color: string; label: string; anchor: [number, number] }
> = {
  North: { color: "#8a6d3b", label: "North", anchor: [111.5, 41.5] },
  Northeast: { color: "#4f7d8c", label: "Northeast", anchor: [126.5, 46.5] },
  East: { color: "#1d5c9e", label: "East", anchor: [118.6, 32.6] },
  South: { color: "#3d8a5f", label: "South", anchor: [110.5, 23.2] },
  Southwest: { color: "#7d5b8a", label: "Southwest", anchor: [101.5, 28.8] },
  Northwest: { color: "#b0713f", label: "Northwest", anchor: [92.0, 40.5] },
  Central: { color: "#a8564e", label: "Central", anchor: [112.6, 31.2] },
};

export const REGION_ORDER: ChinaRegion[] = [
  "North",
  "Northeast",
  "East",
  "Central",
  "South",
  "Southwest",
  "Northwest",
];
