import type { SeasonalEffectPresetId } from "@/types/api";

export interface SeasonalPresetMeta {
  id: SeasonalEffectPresetId;
  labelEn: string;
  labelVi: string;
  descEn: string;
  descVi: string;
  /** Neon accent colours used for subtle border glow & preview swatch. */
  accentPrimary: string;
  accentSecondary: string;
  /** Decorative swatch gradient for Admin preset cards. */
  swatchGradient: string;
  /** Whether this preset uses a calm, solemn visual treatment (no falling animation). */
  solemn?: boolean;
}

export const SEASONAL_PRESETS: SeasonalPresetMeta[] = [
  {
    id: "christmas",
    labelEn: "Christmas",
    labelVi: "Giáng sinh",
    descEn: "Snow resting on the header edge with icicles and frost glints, a snow drift along the sidebar, and gentle snowfall.",
    descVi: "Lớp tuyết phủ mép header với cột băng và ánh băng lấp lánh, bãi tuyết chạy dọc chân sidebar và tuyết rơi nhẹ.",
    accentPrimary: "#ef4444",
    accentSecondary: "#38bdf8",
    swatchGradient: "linear-gradient(135deg, #b91c1c 0%, #15803d 55%, #0284c7 100%)",
  },
  {
    id: "lunar_new_year",
    labelEn: "Lunar New Year (Tết)",
    labelVi: "Tết Nguyên Đán",
    descEn: "A red silk band with gold coins and blossoms on the header edge, a peach-and-apricot branch at the foot of the sidebar, and drifting petals.",
    descVi: "Dải lụa đỏ viền vàng điểm đồng xu và hoa trên mép header, cành đào mai ở chân sidebar và cánh hoa rơi nhẹ.",
    accentPrimary: "#dc2626",
    accentSecondary: "#f59e0b",
    swatchGradient: "linear-gradient(135deg, #b91c1c 0%, #dc2626 50%, #f59e0b 100%)",
  },
  {
    id: "new_year",
    labelEn: "New Year's Day",
    labelVi: "Tết Dương lịch",
    descEn: "A champagne bead string on the header edge, a small starburst at the foot of the sidebar, and golden sparkles.",
    descVi: "Chuỗi hạt vàng champagne trên mép header, chùm pháo hoa nhỏ ở chân sidebar và kim tuyến lấp lánh.",
    accentPrimary: "#f59e0b",
    accentSecondary: "#6366f1",
    swatchGradient: "linear-gradient(135deg, #1e1b4b 0%, #4f46e5 50%, #f59e0b 100%)",
  },
  {
    id: "national_red_gold",
    labelEn: "National Celebration (30/4 · 1/5 · 2/9 · 22/12)",
    labelVi: "Lễ trọng đại (30/4 · 1/5 · 2/9 · 22/12)",
    descEn: "A crimson ribbon with gold stars on the header edge and a faceted gold star at the foot of the sidebar.",
    descVi: "Dải ruy băng đỏ điểm sao vàng trên mép header và ngôi sao vàng ở chân sidebar.",
    accentPrimary: "#dc2626",
    accentSecondary: "#eab308",
    swatchGradient: "linear-gradient(135deg, #991b1b 0%, #dc2626 60%, #eab308 100%)",
  },
  {
    id: "heritage_gold",
    labelEn: "Hung Kings' Commemoration",
    labelVi: "Giỗ Tổ Hùng Vương (10/3 ÂL)",
    descEn: "A bronze meander band on the header edge and a Dong Son drum face at the foot of the sidebar.",
    descVi: "Dải hoa văn chữ triện màu đồng trên mép header và mặt trống đồng ở chân sidebar.",
    accentPrimary: "#b45309",
    accentSecondary: "#f59e0b",
    swatchGradient: "linear-gradient(135deg, #78350f 0%, #b45309 55%, #fbbf24 100%)",
  },
  {
    id: "lotus_gold",
    labelEn: "Lotus & Warm Gold (19/5)",
    labelVi: "Hoa sen trang trọng (19/5)",
    descEn: "A row of lotus petals on a gold line along the header edge and a lotus on a calm pond at the foot of the sidebar.",
    descVi: "Hàng cánh sen trên chỉ vàng dọc mép header và đoá sen trên mặt hồ ở chân sidebar.",
    accentPrimary: "#ec4899",
    accentSecondary: "#f59e0b",
    swatchGradient: "linear-gradient(135deg, #9d174d 0%, #ec4899 55%, #f59e0b 100%)",
  },
  {
    id: "floral_pink",
    labelEn: "Floral Blossom (8/3 · 20/10)",
    labelVi: "Hoa hồng dịu nhẹ (8/3 · 20/10)",
    descEn: "A rose vine along the header edge, roses at the foot of the sidebar, and gently drifting petals.",
    descVi: "Dây hoa hồng chạy dọc mép header, khóm hồng ở chân sidebar và cánh hoa rơi nhẹ.",
    accentPrimary: "#f43f5e",
    accentSecondary: "#f472b6",
    swatchGradient: "linear-gradient(135deg, #be123c 0%, #f43f5e 55%, #fbcfe8 100%)",
  },
  {
    id: "teachers_day",
    labelEn: "Teachers' Day (20/11)",
    labelVi: "Tri ân Nhà giáo (20/11)",
    descEn: "A certificate-style laurel border on the header edge, a quiet row of book spines with a mortarboard at the foot of the sidebar, and slow golden motes.",
    descVi: "Viền nguyệt quế kiểu bằng khen trên mép header, hàng gáy sách cùng chiếc mũ cử nhân ở chân sidebar và những hạt vàng trôi chậm.",
    accentPrimary: "#0f766e",
    accentSecondary: "#c9993a",
    swatchGradient: "linear-gradient(135deg, #052e2b 0%, #0f766e 55%, #e3b341 100%)",
  },
  {
    id: "mid_autumn",
    labelEn: "Mid-Autumn Festival",
    labelVi: "Tết Trung Thu (15/8 ÂL)",
    descEn: "Auspicious clouds on the header edge, a full moon over clouds at the foot of the sidebar, and warm fireflies.",
    descVi: "Dải mây lành trên mép header, trăng rằm và mây ở chân sidebar cùng đom đóm vàng ấm.",
    accentPrimary: "#d97706",
    accentSecondary: "#fbbf24",
    swatchGradient: "linear-gradient(135deg, #1e1b4b 0%, #b45309 55%, #fde047 100%)",
  },
  {
    id: "halloween",
    labelEn: "Halloween",
    labelVi: "Halloween",
    descEn: "A bat-wing scalloped band with little pumpkins on the header edge, a jack-o'-lantern and bats at the foot of the sidebar.",
    descVi: "Dải viền cánh dơi điểm bí ngô trên mép header, bí ngô và dơi bay ở chân sidebar.",
    accentPrimary: "#9333ea",
    accentSecondary: "#f97316",
    swatchGradient: "linear-gradient(135deg, #3b0764 0%, #7e22ce 55%, #ea580c 100%)",
  },
  {
    id: "blue_neon",
    labelEn: "Modern Cyan-Blue Neon (19/11)",
    labelVi: "Neon xanh hiện đại (19/11)",
    descEn: "A cyan circuit line with ticks on the header edge and a floating prism at the foot of the sidebar.",
    descVi: "Đường mạch cyan có vạch chia trên mép header và khối lăng kính ở chân sidebar.",
    accentPrimary: "#0284c7",
    accentSecondary: "#22d3ee",
    swatchGradient: "linear-gradient(135deg, #0c4a6e 0%, #0284c7 55%, #22d3ee 100%)",
  },
  {
    id: "valentine",
    labelEn: "Valentine's Day (14/2)",
    labelVi: "Valentine (14/2)",
    descEn: "A lace edge with tiny hearts on the header, a beating heart and a rose at the foot of the sidebar.",
    descVi: "Viền ren điểm tim nhỏ trên header, trái tim đập nhẹ và hoa hồng ở chân sidebar.",
    accentPrimary: "#e11d48",
    accentSecondary: "#fb7185",
    swatchGradient: "linear-gradient(135deg, #9f1239 0%, #e11d48 55%, #fda4af 100%)",
  },
  {
    id: "spring_green",
    labelEn: "Spring Green (St. Patrick · Earth Day)",
    labelVi: "Xanh mùa xuân (St. Patrick · Ngày Trái Đất)",
    descEn: "A strip of fresh grass on the header edge, a four-leaf clover at the foot of the sidebar, and drifting clovers.",
    descVi: "Dải cỏ non trên mép header, cỏ bốn lá ở chân sidebar và lá cỏ bay nhẹ.",
    accentPrimary: "#15803d",
    accentSecondary: "#4ade80",
    swatchGradient: "linear-gradient(135deg, #14532d 0%, #16a34a 55%, #bbf7d0 100%)",
  },
  {
    id: "easter",
    labelEn: "Easter",
    labelVi: "Lễ Phục sinh",
    descEn: "Pastel eggs nestled in grass along the header edge, eggs and a daisy at the foot of the sidebar.",
    descVi: "Trứng pastel nằm trong cỏ dọc mép header, trứng và hoa cúc ở chân sidebar.",
    accentPrimary: "#a78bfa",
    accentSecondary: "#6ee7b7",
    swatchGradient: "linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #6ee7b7 100%)",
  },
  {
    id: "kids_party",
    labelEn: "Children's Day",
    labelVi: "Ngày Thiếu nhi (1/6)",
    descEn: "Short bunting flags on the header edge, balloons at the foot of the sidebar, and confetti.",
    descVi: "Cờ đuôi nheo ngắn trên mép header, bóng bay ở chân sidebar và hoa giấy vui nhộn.",
    accentPrimary: "#f97316",
    accentSecondary: "#38bdf8",
    swatchGradient: "linear-gradient(135deg, #f97316 0%, #facc15 40%, #38bdf8 100%)",
  },
  {
    id: "autumn_harvest",
    labelEn: "Autumn Harvest (Thanksgiving)",
    labelVi: "Mùa thu hoạch (Lễ Tạ ơn)",
    descEn: "Maple leaves on a twig along the header edge, wheat and leaves at the foot of the sidebar, and falling leaves.",
    descVi: "Lá phong trên cành dọc mép header, lúa mì và lá thu ở chân sidebar cùng lá rơi nhẹ.",
    accentPrimary: "#c2410c",
    accentSecondary: "#f59e0b",
    swatchGradient: "linear-gradient(135deg, #7c2d12 0%, #c2410c 55%, #fbbf24 100%)",
  },
  {
    id: "memorial_candle",
    labelEn: "Solemn Memorial (27/7)",
    labelVi: "Tri ân trang nghiêm (27/7)",
    descEn: "A quiet amber hairline under the header and a single candle at the foot of the sidebar, with no festive motion.",
    descVi: "Đường chỉ vàng hổ phách trầm dưới header và một ngọn nến ở chân sidebar, không có chuyển động lễ hội.",
    accentPrimary: "#b45309",
    accentSecondary: "#d97706",
    swatchGradient: "linear-gradient(135deg, #451a03 0%, #92400e 55%, #d97706 100%)",
    solemn: true,
  },
];

export function getSeasonalPresetMeta(
  id: SeasonalEffectPresetId,
): SeasonalPresetMeta | undefined {
  return SEASONAL_PRESETS.find((item) => item.id === id);
}

const EVENT_GREETINGS: Record<string, { vi: string; en: string }> = {
  new_year: { vi: "Chúc mừng Năm mới!", en: "Happy New Year!" },
  lunar_new_year: { vi: "Chúc mừng năm mới · An khang thịnh vượng!", en: "Happy Lunar New Year!" },
  womens_day: { vi: "Chúc mừng ngày Quốc tế Phụ nữ 8/3!", en: "Happy Women's Day!" },
  hung_kings: { vi: "Giỗ Tổ Hùng Vương 10/3 ÂL", en: "Hung Kings' Commemoration" },
  reunification_day: { vi: "Chào mừng 30/4 · Thống nhất đất nước", en: "Happy Reunification Day" },
  labor_day: { vi: "Chúc mừng Quốc tế Lao động 1/5!", en: "Happy Workers' Day!" },
  ho_chi_minh_birthday: { vi: "Kỷ niệm ngày sinh Chủ tịch Hồ Chí Minh 19/5", en: "Ho Chi Minh's Birthday" },
  war_invalids_day: { vi: "Tri ân ngày Thương binh - Liệt sĩ 27/7", en: "Day of Remembrance · 27/7" },
  national_day: { vi: "Chào mừng Quốc khánh 2/9!", en: "Happy National Day!" },
  mid_autumn: { vi: "Tết Trung Thu đoàn viên!", en: "Happy Mid-Autumn Festival!" },
  vietnamese_womens_day: { vi: "Chúc mừng ngày Phụ nữ Việt Nam 20/10!", en: "Happy Vietnamese Women's Day!" },
  halloween: { vi: "Happy Halloween!", en: "Happy Halloween!" },
  mens_day: { vi: "Chúc mừng ngày Quốc tế Nam giới 19/11!", en: "Happy International Men's Day!" },
  peoples_army_day: { vi: "Chào mừng ngày QĐND Việt Nam 22/12", en: "Vietnam People's Army Day" },
  christmas: { vi: "Giáng sinh an lành!", en: "Merry Christmas!" },
  lantern_festival: { vi: "Rằm tháng Giêng · Tết Nguyên tiêu", en: "Lantern Festival" },
  party_founding: { vi: "Mừng Đảng, mừng Xuân · 3/2", en: "Founding of the Communist Party · 3/2" },
  valentine: { vi: "Happy Valentine!", en: "Happy Valentine's Day!" },
  doctors_day: { vi: "Chúc mừng Ngày Thầy thuốc Việt Nam 27/2!", en: "Happy Vietnamese Doctors' Day!" },
  han_thuc: { vi: "Tết Hàn thực 3/3 ÂL", en: "Cold Food Festival" },
  st_patrick: { vi: "Happy St. Patrick's Day!", en: "Happy St. Patrick's Day!" },
  youth_union_day: { vi: "Mừng ngày thành lập Đoàn 26/3", en: "Youth Union Day · 26/3" },
  easter: { vi: "Chúc mừng Lễ Phục sinh!", en: "Happy Easter!" },
  book_day: { vi: "Ngày Sách và Văn hóa đọc Việt Nam", en: "Book and Reading Culture Day" },
  earth_day: { vi: "Ngày Trái Đất · Chung tay bảo vệ hành tinh", en: "Happy Earth Day!" },
  mothers_day: { vi: "Chúc mừng Ngày của Mẹ!", en: "Happy Mother's Day!" },
  vesak: { vi: "Mừng Lễ Phật Đản", en: "Happy Vesak Day" },
  dragon_boat: { vi: "Tết Đoan Ngọ 5/5 ÂL", en: "Dragon Boat Festival" },
  childrens_day: { vi: "Chúc mừng Ngày Quốc tế Thiếu nhi 1/6!", en: "Happy Children's Day!" },
  press_day: { vi: "Chúc mừng Ngày Báo chí Cách mạng 21/6", en: "Vietnam Press Day · 21/6" },
  family_day: { vi: "Chúc mừng Ngày Gia đình Việt Nam 28/6", en: "Vietnamese Family Day · 28/6" },
  fathers_day: { vi: "Chúc mừng Ngày của Cha!", en: "Happy Father's Day!" },
  vu_lan: { vi: "Lễ Vu Lan báo hiếu", en: "Vu Lan · Filial Piety Festival" },
  august_revolution: { vi: "Kỷ niệm Cách mạng tháng Tám 19/8", en: "August Revolution Day · 19/8" },
  entrepreneurs_day: { vi: "Chúc mừng Ngày Doanh nhân Việt Nam 13/10", en: "Vietnam Entrepreneurs' Day" },
  teachers_day: { vi: "Chúc mừng Ngày Nhà giáo Việt Nam 20/11!", en: "Happy Vietnamese Teachers' Day!" },
  thanksgiving: { vi: "Lễ Tạ ơn · Biết ơn và sẻ chia", en: "Happy Thanksgiving!" },
  kitchen_gods: { vi: "Ông Công, Ông Táo chầu trời 23/12 ÂL", en: "Kitchen Gods' Day" },
};

const PRESET_GREETINGS: Record<SeasonalEffectPresetId, { vi: string; en: string }> = {
  none: { vi: "", en: "" },
  christmas: { vi: "Giáng sinh an lành!", en: "Merry Christmas!" },
  lunar_new_year: { vi: "Chúc mừng năm mới!", en: "Happy Lunar New Year!" },
  new_year: { vi: "Chúc mừng Năm mới!", en: "Happy New Year!" },
  national_red_gold: { vi: "Chào mừng ngày lễ trọng đại!", en: "National Celebration" },
  heritage_gold: { vi: "Giỗ Tổ Hùng Vương 10/3 ÂL", en: "Hung Kings' Commemoration" },
  lotus_gold: { vi: "Kỷ niệm 19/5", en: "Commemoration · May 19" },
  floral_pink: { vi: "Chúc mừng ngày lễ!", en: "Happy Celebration!" },
  mid_autumn: { vi: "Tết Trung Thu đoàn viên!", en: "Happy Mid-Autumn Festival!" },
  halloween: { vi: "Happy Halloween!", en: "Happy Halloween!" },
  blue_neon: { vi: "Chúc mừng ngày Quốc tế Nam giới 19/11!", en: "Happy International Men's Day!" },
  memorial_candle: { vi: "Tri ân ngày Thương binh - Liệt sĩ 27/7", en: "Day of Remembrance · 27/7" },
  valentine: { vi: "Happy Valentine!", en: "Happy Valentine's Day!" },
  spring_green: { vi: "Chào mùa xuân xanh!", en: "Happy Spring!" },
  easter: { vi: "Chúc mừng Lễ Phục sinh!", en: "Happy Easter!" },
  kids_party: { vi: "Chúc mừng Ngày Thiếu nhi!", en: "Happy Children's Day!" },
  autumn_harvest: { vi: "Mùa thu hoạch an lành!", en: "Happy Thanksgiving!" },
  teachers_day: { vi: "Tri ân Nhà giáo Việt Nam 20/11", en: "Honouring our teachers" },
};

export function getSeasonalGreeting({
  eventId,
  preset,
  eventNameEn,
  eventNameVi,
  locale,
}: {
  eventId: string | null;
  preset: SeasonalEffectPresetId;
  eventNameEn: string | null;
  eventNameVi: string | null;
  locale: string;
}): string {
  if (!preset || preset === "none") return "";
  if (eventId && EVENT_GREETINGS[eventId]) {
    return locale === "vi"
      ? EVENT_GREETINGS[eventId].vi
      : EVENT_GREETINGS[eventId].en;
  }
  if (eventNameVi || eventNameEn) {
    return locale === "vi"
      ? eventNameVi || eventNameEn || ""
      : eventNameEn || eventNameVi || "";
  }
  const fallback = PRESET_GREETINGS[preset];
  return locale === "vi" ? fallback.vi : fallback.en;
}
