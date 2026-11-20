"use client";

import { EXTRA_HOLIDAY_DETAILS } from "@/components/seasonal/holiday-details-extra";
import { getSeasonalPresetMeta } from "@/components/seasonal/seasonal-presets";
import { ThumbScene } from "@/components/seasonal/seasonal-thumb-scenes";
import type { SeasonalEffectPresetId } from "@/types/api";

export interface HolidayDetailInfo {
  originVi: string;
  originEn: string;
  summaryVi: string;
  summaryEn: string;
  highlightsVi: string[];
  highlightsEn: string[];
}

/**
 * Curated historical & cultural details for the original built-in holidays.
 */
const CORE_HOLIDAY_DETAILS: Record<string, HolidayDetailInfo> = {
  new_year: {
    originVi: "Lịch Dương (Gregorian) · 01/01 hàng năm",
    originEn: "Gregorian Calendar · January 1 annually",
    summaryVi:
      "Ngày đầu tiên của năm mới theo Dương lịch, đánh dấu thời khắc khép lại năm cũ và chào đón một khởi đầu mới tràn đầy hy vọng trên toàn thế giới.",
    summaryEn:
      "Marks the first day of the Gregorian year, celebrated worldwide as a moment of reflection, fresh beginnings, and shared hopes for the year ahead.",
    highlightsVi: [
      "Bắn pháo hoa và lễ hội đếm ngược (Countdown) đêm giao thừa 31/12.",
      "Gửi lời chúc bình an, sum họp gia đình và nghỉ lễ chính thức 1 ngày.",
    ],
    highlightsEn: [
      "New Year's Eve countdowns and midnight fireworks across major cities.",
      "Official 1-day public holiday for rest, reflection, and family gatherings.",
    ],
  },
  lunar_new_year: {
    originVi: "Truyền thống lâu đời · Cuối tháng Chạp đến đầu tháng Giêng ÂL",
    originEn: "Ancient Vietnamese tradition · Late 12th to early 1st Lunar month",
    summaryVi:
      "Tết Nguyên Đán là lễ hội lớn và thiêng liêng nhất trong năm của người Việt, mang ý nghĩa đoàn viên gia đình, tri ân tổ tiên và cầu chúc một năm mới an khang, thịnh vượng.",
    summaryEn:
      "Vietnam's most important and sacred festival, welcoming spring with family reunions, ancestral remembrance, and wishes for health and prosperity.",
    highlightsVi: [
      "Dọn dẹp, trang trí nhà cửa bằng hoa đào, hoa mai, cây quất và gói bánh chưng, bánh tét.",
      "Cúng giao thừa, chúc Tết ông bà, trao lì xì đầu năm và đi lễ chùa cầu bình an.",
    ],
    highlightsEn: [
      "Decorating homes with peach/apricot blossoms and preparing bánh chưng or bánh tét.",
      "Visiting relatives, giving lucky money (lì xì), and offering prayers for the new year.",
    ],
  },
  womens_day: {
    originVi: "Liên Hợp Quốc công nhận · 08/03 hàng năm",
    originEn: "UN-recognized observance · March 8 annually",
    summaryVi:
      "Ngày Quốc tế Phụ nữ tôn vinh những đóng góp to lớn của phụ nữ trong gia đình, xã hội, khoa học và kinh tế, đồng thời thúc đẩy bình đẳng giới trên toàn cầu.",
    summaryEn:
      "Celebrates the social, economic, cultural, and political achievements of women worldwide while championing gender equality and mutual respect.",
    highlightsVi: [
      "Tặng hoa, thiệp và gửi lời tri ân tới mẹ, vợ, đồng nghiệp và bạn bè nữ.",
      "Tổ chức các hoạt động tôn vinh và gắn kết trong cơ quan, doanh nghiệp.",
    ],
    highlightsEn: [
      "Sharing flowers, notes, and gratitude with mothers, partners, and colleagues.",
      "Workplace and community events honoring women's leadership and impact.",
    ],
  },
  hung_kings: {
    originVi: "10/03 Âm lịch · Đền Hùng, Phú Thọ (Di sản UNESCO)",
    originEn: "10th day of 3rd Lunar month · Hung Temple, Phu Tho",
    summaryVi:
      "Ngày Giỗ Tổ Hùng Vương tưởng nhớ công lao dựng nước của các Vua Hùng — cội nguồn dân tộc Việt Nam, thể hiện sâu sắc đạo lý “Uống nước nhớ nguồn”.",
    summaryEn:
      "Honors the legendary Hung Kings, founders of the first Vietnamese state (Van Lang), embodying the cherished principle of remembering one's roots.",
    highlightsVi: [
      "Lễ dâng hương quốc gia tại Khu di tích lịch sử Đền Hùng (Phú Thọ).",
      "Các hoạt động văn hóa dân gian, gói bánh chưng, bánh giầy và nghỉ lễ 1 ngày.",
    ],
    highlightsEn: [
      "National incense-offering ceremony at the Hung Temple complex on Nghia Linh Mountain.",
      "Traditional folk ceremonies, offerings, and an official 1-day public holiday.",
    ],
  },
  reunification_day: {
    originVi: "Mốc lịch sử 30/04/1975 · Thống nhất đất nước",
    originEn: "Historic milestone · April 30, 1975",
    summaryVi:
      "Kỷ niệm ngày Giải phóng miền Nam, thống nhất đất nước (30/04/1975), khép lại chiến tranh và mở ra kỷ nguyên hòa bình, độc lập, thống nhất toàn vẹn lãnh thổ Việt Nam.",
    summaryEn:
      "Commemorates the historic reunification of North and South Vietnam on April 30, 1975, marking the end of the war and the beginning of national peace and unity.",
    highlightsVi: [
      "Treo cờ Tổ quốc, triển lãm lịch sử và các chương trình nghệ thuật kỷ niệm.",
      "Nghỉ lễ chính thức 1 ngày, thường kết hợp cùng ngày 01/05 tạo kỳ nghỉ dài.",
    ],
    highlightsEn: [
      "Patriotic flag displays, historical exhibitions, and commemorative programs.",
      "Official 1-day public holiday, paired with May 1 for an extended break.",
    ],
  },
  labor_day: {
    originVi: "Phong trào công nhân quốc tế · 01/05 hàng năm",
    originEn: "International labor movement · May 1 annually",
    summaryVi:
      "Ngày Quốc tế Lao động tôn vinh giai cấp công nhân và những người lao động trên toàn thế giới, khẳng định giá trị của sức lao động, quyền lợi và sự đoàn kết.",
    summaryEn:
      "Honors workers and the labor movement worldwide, recognizing the dignity of work, fair working conditions, and solidarity across all professions.",
    highlightsVi: [
      "Các hoạt động biểu dương người lao động tiêu biểu và phong trào thi đua.",
      "Ngày nghỉ lễ chính thức 1 ngày để tái tạo năng lượng bên gia đình.",
    ],
    highlightsEn: [
      "Recognizing dedicated workers and workplace achievements across industries.",
      "Official 1-day public holiday for rest, travel, and family time.",
    ],
  },
  ho_chi_minh_birthday: {
    originVi: "19/05/1890 · Làng Sen, Kim Liên, Nghệ An",
    originEn: "May 19, 1890 · Kim Lien, Nghe An",
    summaryVi:
      "Kỷ niệm ngày sinh Chủ tịch Hồ Chí Minh — vị lãnh tụ kính yêu của dân tộc Việt Nam, Anh hùng giải phóng dân tộc và Danh nhân văn hóa thế giới.",
    summaryEn:
      "Commemorates the birth anniversary of President Ho Chi Minh (1890–1969), founding father of modern Vietnam and revered national leader.",
    highlightsVi: [
      "Dâng hoa tại Lăng Chủ tịch Hồ Chí Minh, Bảo tàng và các khu di tích.",
      "Sinh hoạt chuyên đề học tập tư tưởng, đạo đức, phong cách Hồ Chí Minh.",
    ],
    highlightsEn: [
      "Flower-offering ceremonies at Ho Chi Minh Mausoleum and memorial sites.",
      "Exhibitions and cultural programs reflecting on his life and legacy.",
    ],
  },
  war_invalids_day: {
    originVi: "27/07/1947 · Ngày Thương binh toàn quốc",
    originEn: "Established July 27, 1947 · National Day of Remembrance",
    summaryVi:
      "Ngày trang nghiêm tưởng niệm và bày tỏ lòng biết ơn sâu sắc đối với các Anh hùng Liệt sĩ, thương binh, bệnh binh và các gia đình có công với cách mạng.",
    summaryEn:
      "A solemn national day dedicated to honoring fallen martyrs, wounded soldiers, veterans, and families who sacrificed for the nation's independence.",
    highlightsVi: [
      "Lễ thắp nến tri ân, dâng hương tại nghĩa trang và đài tưởng niệm liệt sĩ.",
      "Thăm hỏi, phụng dưỡng Mẹ Việt Nam Anh hùng và gia đình chính sách.",
    ],
    highlightsEn: [
      "Candlelight vigils and incense offerings at war memorials nationwide.",
      "Visiting and supporting veterans, Heroic Mothers, and policy families.",
    ],
  },
  national_day: {
    originVi: "02/09/1945 · Quảng trường Ba Đình, Hà Nội",
    originEn: "September 2, 1945 · Ba Dinh Square, Hanoi",
    summaryVi:
      "Kỷ niệm ngày Chủ tịch Hồ Chí Minh đọc bản Tuyên ngôn Độc lập tại Quảng trường Ba Đình, khai sinh nước Việt Nam Dân chủ Cộng hòa — nay là nước CHXHCN Việt Nam.",
    summaryEn:
      "Marks the historic day in 1945 when President Ho Chi Minh read the Proclamation of Independence at Ba Dinh Square, founding modern Vietnam.",
    highlightsVi: [
      "Rực rỡ cờ đỏ sao vàng trên khắp phố phường, lễ mít-tinh và bắn pháo hoa.",
      "Nghỉ lễ chính thức 2 ngày (02/09 và 1 ngày liền kề trước hoặc sau).",
    ],
    highlightsEn: [
      "Nationwide red-and-gold flag displays, cultural concerts, and fireworks.",
      "Official 2-day public holiday (Sep 2 plus one adjacent day).",
    ],
  },
  mid_autumn: {
    originVi: "15/08 Âm lịch · Tết Đoàn viên & Tết Thiếu nhi",
    originEn: "15th day of 8th Lunar month · Harvest & Reunion Festival",
    summaryVi:
      "Tết Trung Thu diễn ra vào đêm trăng tròn đẹp nhất mùa thu, là dịp gia đình sum vầy thưởng trà, ăn bánh trung thu và mang đến niềm vui rước đèn cho trẻ nhỏ.",
    summaryEn:
      "Celebrated under the brightest full moon of autumn, uniting families over tea and mooncakes while delighting children with star lanterns and lion dances.",
    highlightsVi: [
      "Rước đèn ông sao, múa lân sư rồng và phá cỗ đêm trăng rằm.",
      "Biếu tặng bánh nướng, bánh dẻo gửi gắm lời chúc đoàn viên, viên mãn.",
    ],
    highlightsEn: [
      "Colorful star-lantern parades, lion dances, and moon-gazing gatherings.",
      "Sharing traditional baked and snow-skin mooncakes with loved ones.",
    ],
  },
  vietnamese_womens_day: {
    originVi: "20/10/1930 · Thành lập Hội Liên hiệp Phụ nữ Việt Nam",
    originEn: "October 20, 1930 · Founding of Vietnam Women's Union",
    summaryVi:
      "Ngày Phụ nữ Việt Nam tôn vinh vẻ đẹp, đức hy sinh và bản lĩnh “Anh hùng, Bất khuất, Trung hậu, Đảm đang” của người phụ nữ Việt Nam qua các thời kỳ.",
    summaryEn:
      "Commemorates the founding of the Vietnam Women's Union in 1930, celebrating Vietnamese women's resilience, warmth, and vital contributions to family and society.",
    highlightsVi: [
      "Gửi tặng hoa tươi, quà tặng và lời chúc ý nghĩa tới phái đẹp.",
      "Hoạt động tri ân, giao lưu tại cơ quan, trường học và gia đình.",
    ],
    highlightsEn: [
      "Expressing appreciation to mothers, wives, daughters, and colleagues with flowers and gifts.",
      "Warm workplace gatherings and celebratory events across Vietnam.",
    ],
  },
  halloween: {
    originVi: "31/10 hàng năm · Lễ hội hóa trang mùa thu",
    originEn: "October 31 annually · Autumn Eve Festival",
    summaryVi:
      "Lễ hội hóa trang phổ biến trên thế giới vào đêm cuối tháng 10, nổi bật với đèn bí ngô phát sáng, không khí huyền bí vui nhộn và các hoạt động sáng tạo.",
    summaryEn:
      "A playful autumn festival celebrated on October 31 featuring glowing jack-o'-lanterns, creative costumes, spooky decorations, and community fun.",
    highlightsVi: [
      "Trang trí bí ngô, đèn lồng cam-tím và không gian chủ đề ma mị vui vẻ.",
      "Hóa trang sáng tạo và giao lưu teambuilding nhẹ nhàng.",
    ],
    highlightsEn: [
      "Carved pumpkin lanterns, twilight decor, and festive treats.",
      "Creative costume themes and lively social or team gatherings.",
    ],
  },
  mens_day: {
    originVi: "Khởi xướng năm 1999 · Tiến sĩ Jerome Teelucksingh (19/11)",
    originEn: "Inaugurated Nov 19, 1999 · Dr. Jerome Teelucksingh",
    summaryVi:
      "Ngày Quốc tế Nam giới (19/11) tôn vinh những đóng góp tích cực của nam giới trong gia đình, công việc và cộng đồng, đồng thời nâng cao nhận thức về sức khỏe thể chất & tinh thần của phái mạnh.",
    summaryEn:
      "Observed in over 80 countries to recognize men's positive contributions to families and communities, highlight men's physical & mental well-being, and foster healthy gender relations.",
    highlightsVi: [
      "Tôn vinh những hình mẫu nam giới trách nhiệm, tận tâm trong gia đình và công việc.",
      "Quan tâm sức khỏe tinh thần, cân bằng cuộc sống và gắn kết đồng nghiệp.",
    ],
    highlightsEn: [
      "Celebrating positive male role models in everyday life and the workplace.",
      "Promoting men's physical & mental health awareness and mutual respect.",
    ],
  },
  peoples_army_day: {
    originVi: "22/12/1944 · Thành lập Đội Việt Nam Tuyên truyền Giải phóng quân",
    originEn: "December 22, 1944 · Founded in Cao Bang Province",
    summaryVi:
      "Kỷ niệm ngày thành lập Quân đội Nhân dân Việt Nam và Ngày hội Quốc phòng toàn dân, tri ân các thế hệ cán bộ, chiến sĩ đã bảo vệ vững chắc độc lập, chủ quyền Tổ quốc.",
    summaryEn:
      "Commemorates the founding of the Vietnam People's Army in 1944 and National Defense Day, honoring generations of soldiers dedicated to protecting the nation.",
    highlightsVi: [
      "Tri ân các cựu chiến binh, quân nhân và tôn vinh phẩm chất “Bộ đội Cụ Hồ”.",
      "Giao lưu văn hóa, thể thao và giáo dục truyền thống yêu nước.",
    ],
    highlightsEn: [
      "Honoring veterans and active service members for their dedication.",
      "Civic ceremonies, exhibitions, and cultural exchanges nationwide.",
    ],
  },
  christmas: {
    originVi: "25/12 hàng năm · Lễ Giáng sinh (Noel)",
    originEn: "December 25 annually · Christmas Day",
    summaryVi:
      "Lễ Giáng sinh là dịp lễ ấm áp cuối năm mang thông điệp hòa bình, yêu thương và sẻ chia, rực rỡ với cây thông Noel, ánh đèn lung linh và những món quà bất ngờ.",
    summaryEn:
      "A warm year-end celebration of peace, kindness, and togetherness, illuminated by festive trees, twinkling lights, carols, and thoughtful gift exchanges.",
    highlightsVi: [
      "Trang trí cây thông Noel, dây đèn nhấp nháy và vòng nguyệt quế.",
      "Trao quà Secret Santa, họp mặt ấm cúng cùng đồng nghiệp và gia đình.",
    ],
    highlightsEn: [
      "Festive evergreens, twinkling fairy lights, and winter decorations.",
      "Gift exchanges, Secret Santa activities, and warm year-end gatherings.",
    ],
  },
};

export const HOLIDAY_DETAILS: Record<string, HolidayDetailInfo> = {
  ...CORE_HOLIDAY_DETAILS,
  ...EXTRA_HOLIDAY_DETAILS,
};

/**
 * Illustrated 16:7 thumbnail for a holiday, composed from the same hand-built
 * vector motifs as the seasonal overlays. Renders instantly with zero external
 * requests (works air-gapped).
 */
export function HolidayThumbnail({
  preset,
  label,
}: {
  eventId?: string;
  preset: SeasonalEffectPresetId;
  label: string;
}) {
  const presetMeta = getSeasonalPresetMeta(preset);
  const bg =
    presetMeta?.swatchGradient ??
    "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)";

  return (
    <div
      className="relative h-28 w-full shrink-0 overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
      style={{ background: bg }}
      role="img"
      aria-label={label}
    >
      <ThumbScene preset={preset} />
      {/* Subtle bottom vignette for visual polish */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/35 to-transparent" />
    </div>
  );
}
