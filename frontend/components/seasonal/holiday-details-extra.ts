import type { HolidayDetailInfo } from "@/components/seasonal/holiday-details";

/** Curated details for the extended built-in calendar (Vietnamese + major international). */
export const EXTRA_HOLIDAY_DETAILS: Record<string, HolidayDetailInfo> = {
  lantern_festival: {
    originVi: "15/01 Âm lịch · Rằm đầu tiên của năm",
    originEn: "15th day of the 1st lunar month · first full moon of the year",
    summaryVi:
      "Rằm tháng Giêng (Tết Nguyên tiêu) là đêm trăng tròn đầu tiên của năm mới, khép lại không khí Tết với lễ chùa, dâng hương cầu an và những ánh đèn hoa đăng.",
    summaryEn:
      "The first full moon of the lunar year closes the Tết season with temple visits, prayers for peace and glowing lanterns.",
    highlightsVi: [
      "Đi chùa, dâng hương, cầu bình an và may mắn cho cả năm.",
      "Cúng rằm với bánh trôi, chè, hoa quả; thả đèn hoa đăng.",
    ],
    highlightsEn: [
      "Temple visits and incense offerings for a peaceful, lucky year.",
      "Full-moon offerings and floating lanterns.",
    ],
  },
  party_founding: {
    originVi: "03/02/1930 · Ngày thành lập Đảng Cộng sản Việt Nam",
    originEn: "February 3, 1930 · founding of the Communist Party of Vietnam",
    summaryVi:
      "Kỷ niệm ngày thành lập Đảng Cộng sản Việt Nam, thường gắn với câu “Mừng Đảng, mừng Xuân” đầu năm mới.",
    summaryEn:
      "Marks the founding of the Communist Party of Vietnam, traditionally celebrated alongside the arrival of spring.",
    highlightsVi: [
      "Treo cờ, tổ chức các hoạt động kỷ niệm và văn nghệ chào mừng.",
      "Ôn lại truyền thống lịch sử, tri ân các thế hệ đi trước.",
    ],
    highlightsEn: [
      "Flags, commemorative events and cultural performances.",
      "A moment to reflect on history and honour earlier generations.",
    ],
  },
  valentine: {
    originVi: "14/02 hằng năm · Ngày Lễ Tình nhân",
    originEn: "February 14 annually · Valentine's Day",
    summaryVi:
      "Valentine là dịp dành cho tình yêu và sự quan tâm, nơi mọi người gửi tặng hoa, thiệp và lời chúc đến người thương và những người gần gũi.",
    summaryEn:
      "A day for affection and appreciation, marked with flowers, cards and kind words for partners, friends and family.",
    highlightsVi: [
      "Tặng hoa hồng, sô cô la và thiệp viết tay.",
      "Dành thời gian bên người thân yêu, gửi lời cảm ơn chân thành.",
    ],
    highlightsEn: [
      "Roses, chocolates and handwritten cards.",
      "Quality time and sincere thanks to people you care about.",
    ],
  },
  doctors_day: {
    originVi: "27/02/1955 · Thư của Chủ tịch Hồ Chí Minh gửi cán bộ y tế",
    originEn: "February 27, 1955 · President Ho Chi Minh's letter to medical staff",
    summaryVi:
      "Ngày Thầy thuốc Việt Nam tôn vinh những người làm nghề y, “lương y như từ mẫu”, tận tụy chăm sóc sức khỏe cộng đồng.",
    summaryEn:
      "Honours Vietnam's doctors and health workers for their dedication to caring for the community.",
    highlightsVi: [
      "Tri ân bác sĩ, điều dưỡng và nhân viên y tế.",
      "Các hoạt động gặp mặt, khám sức khỏe cộng đồng.",
    ],
    highlightsEn: [
      "Thanking doctors, nurses and health workers.",
      "Community health events and gatherings.",
    ],
  },
  han_thuc: {
    originVi: "03/03 Âm lịch · Tết Hàn thực",
    originEn: "3rd day of the 3rd lunar month · Cold Food Festival",
    summaryVi:
      "Tết Hàn thực là dịp ăn đồ nguội, cúng tổ tiên bằng bánh trôi, bánh chay, thể hiện lòng biết ơn và nhớ về cội nguồn.",
    summaryEn:
      "A festival of cold food and ancestral offerings of sweet rice dumplings, expressing gratitude and remembrance.",
    highlightsVi: [
      "Làm bánh trôi, bánh chay để dâng cúng tổ tiên.",
      "Sum họp gia đình và tưởng nhớ nguồn cội.",
    ],
    highlightsEn: [
      "Preparing bánh trôi and bánh chay as offerings.",
      "Family gatherings and remembrance of ancestors.",
    ],
  },
  st_patrick: {
    originVi: "17/03 hằng năm · Ngày Thánh Patrick",
    originEn: "March 17 annually · St. Patrick's Day",
    summaryVi:
      "Ngày lễ tôn vinh vị thánh bảo trợ của Ireland, nổi bật với màu xanh lá và biểu tượng cỏ ba lá may mắn trên khắp thế giới.",
    summaryEn:
      "Celebrates the patron saint of Ireland, recognised worldwide by its green colour and lucky shamrock.",
    highlightsVi: [
      "Mặc đồ xanh lá, trang trí cỏ ba lá.",
      "Các lễ diễu hành và sự kiện văn hóa Ireland.",
    ],
    highlightsEn: [
      "Wearing green and decorating with shamrocks.",
      "Parades and Irish cultural events.",
    ],
  },
  youth_union_day: {
    originVi: "26/03/1931 · Ngày thành lập Đoàn TNCS Hồ Chí Minh",
    originEn: "March 26, 1931 · Ho Chi Minh Communist Youth Union",
    summaryVi:
      "Ngày truyền thống của tuổi trẻ Việt Nam, ghi nhận vai trò xung kích của thanh niên trong học tập, lao động và xây dựng đất nước.",
    summaryEn:
      "A tradition day for Vietnamese youth, recognising young people's pioneering role in study, work and nation-building.",
    highlightsVi: [
      "Hoạt động tình nguyện, tuyên dương đoàn viên tiêu biểu.",
      "Giao lưu văn nghệ, thể thao cho thanh niên.",
    ],
    highlightsEn: [
      "Volunteer activities and recognition of outstanding members.",
      "Cultural and sports exchanges for young people.",
    ],
  },
  easter: {
    originVi: "Chủ nhật sau trăng tròn đầu mùa xuân · Lễ Phục sinh",
    originEn: "Sunday after the first spring full moon · Easter",
    summaryVi:
      "Lễ Phục sinh là ngày lễ lớn của Kitô giáo, mừng sự phục sinh của Chúa Giêsu, gắn với biểu tượng trứng màu và mùa xuân đâm chồi.",
    summaryEn:
      "A major Christian celebration of resurrection, associated with painted eggs and the renewal of spring.",
    highlightsVi: [
      "Trang trí và tìm trứng Phục sinh nhiều màu sắc.",
      "Dự lễ nhà thờ và sum họp gia đình.",
    ],
    highlightsEn: [
      "Decorating and hunting for coloured eggs.",
      "Church services and family gatherings.",
    ],
  },
  book_day: {
    originVi: "21/04 hằng năm · Ngày Sách và Văn hóa đọc Việt Nam",
    originEn: "April 21 annually · Vietnam Book and Reading Culture Day",
    summaryVi:
      "Ngày khuyến khích thói quen đọc sách và lan tỏa văn hóa đọc trong cộng đồng, nhà trường và nơi làm việc.",
    summaryEn:
      "Encourages reading habits and a culture of reading in communities, schools and workplaces.",
    highlightsVi: [
      "Hội sách, giới thiệu sách hay và tặng sách.",
      "Khuyến khích chia sẻ tri thức trong tổ chức.",
    ],
    highlightsEn: [
      "Book fairs, recommendations and book gifts.",
      "A good moment to share knowledge across teams.",
    ],
  },
  earth_day: {
    originVi: "22/04 hằng năm · Ngày Trái Đất",
    originEn: "April 22 annually · Earth Day",
    summaryVi:
      "Ngày Trái Đất nhắc nhở mọi người về trách nhiệm bảo vệ môi trường, giảm rác thải và sống xanh hơn.",
    summaryEn:
      "Reminds everyone of the responsibility to protect the environment, reduce waste and live more sustainably.",
    highlightsVi: [
      "Trồng cây, nhặt rác, giảm sử dụng nhựa dùng một lần.",
      "Chia sẻ các thói quen thân thiện với môi trường.",
    ],
    highlightsEn: [
      "Tree planting, clean-ups and cutting single-use plastic.",
      "Sharing eco-friendly habits.",
    ],
  },
  mothers_day: {
    originVi: "Chủ nhật thứ hai của tháng 5 · Ngày của Mẹ",
    originEn: "Second Sunday of May · Mother's Day",
    summaryVi:
      "Dịp tri ân và gửi lời cảm ơn đến người mẹ — người luôn yêu thương và hy sinh thầm lặng cho gia đình.",
    summaryEn:
      "A day to thank mothers and mother figures for their love and quiet sacrifices.",
    highlightsVi: [
      "Tặng hoa cẩm chướng, hoa hồng và thiệp cảm ơn.",
      "Bữa cơm đoàn viên và lời chúc chân thành.",
    ],
    highlightsEn: [
      "Carnations, roses and thank-you cards.",
      "A family meal and heartfelt wishes.",
    ],
  },
  vesak: {
    originVi: "15/04 Âm lịch · Lễ Phật Đản",
    originEn: "15th day of the 4th lunar month · Vesak",
    summaryVi:
      "Lễ Phật Đản kỷ niệm ngày đản sinh của Đức Phật, là dịp thanh tịnh với hoa sen, đèn hoa đăng và những việc thiện.",
    summaryEn:
      "Commemorates the birth of the Buddha, observed with lotus flowers, lanterns and acts of kindness.",
    highlightsVi: [
      "Dâng hương, tắm Phật, thả đèn hoa đăng.",
      "Làm việc thiện, phóng sinh, giúp đỡ người khó khăn.",
    ],
    highlightsEn: [
      "Offering incense, ritual bathing of the Buddha and lanterns.",
      "Charity and kindness towards others.",
    ],
  },
  dragon_boat: {
    originVi: "05/05 Âm lịch · Tết Đoan Ngọ",
    originEn: "5th day of the 5th lunar month · Dragon Boat Festival",
    summaryVi:
      "Tết Đoan Ngọ (“Tết diệt sâu bọ”) là dịp ăn rượu nếp, bánh tro và hoa quả theo mùa để giữ gìn sức khỏe giữa mùa hè.",
    summaryEn:
      "Often called the “pest-killing festival”, marked with fermented glutinous rice, ash cakes and seasonal fruit for good health.",
    highlightsVi: [
      "Ăn rượu nếp, bánh tro, trái cây vào buổi sáng sớm.",
      "Cúng tổ tiên và giữ gìn phong tục dân gian.",
    ],
    highlightsEn: [
      "Early-morning rice wine, ash cakes and fruit.",
      "Ancestral offerings and folk customs.",
    ],
  },
  childrens_day: {
    originVi: "01/06 hằng năm · Ngày Quốc tế Thiếu nhi",
    originEn: "June 1 annually · International Children's Day",
    summaryVi:
      "Ngày dành riêng cho trẻ em, nhắc nhở người lớn về quyền được vui chơi, học tập và yêu thương của các em.",
    summaryEn:
      "A day for children, reminding adults of every child's right to play, learn and be loved.",
    highlightsVi: [
      "Liên hoan, vui chơi, tặng quà cho các em nhỏ.",
      "Hoạt động văn nghệ, thể thao cho thiếu nhi.",
    ],
    highlightsEn: [
      "Parties, play and gifts for children.",
      "Performances and sports activities.",
    ],
  },
  press_day: {
    originVi: "21/06/1925 · Báo Thanh Niên số đầu tiên",
    originEn: "June 21, 1925 · first issue of Thanh Niên newspaper",
    summaryVi:
      "Ngày Báo chí Cách mạng Việt Nam tôn vinh những người làm báo và vai trò của báo chí trong thông tin, định hướng và phản ánh cuộc sống.",
    summaryEn:
      "Honours Vietnamese journalists and the role of the press in informing the public and reflecting society.",
    highlightsVi: [
      "Tri ân phóng viên, biên tập viên, nhà báo.",
      "Các buổi gặp mặt, trao giải báo chí.",
    ],
    highlightsEn: [
      "Thanking reporters, editors and journalists.",
      "Press meetings and awards.",
    ],
  },
  family_day: {
    originVi: "28/06 hằng năm · Ngày Gia đình Việt Nam",
    originEn: "June 28 annually · Vietnamese Family Day",
    summaryVi:
      "Ngày tôn vinh giá trị gia đình, khuyến khích các thành viên dành thời gian cho nhau và vun đắp hạnh phúc.",
    summaryEn:
      "Celebrates family values and encourages spending time together and nurturing happiness at home.",
    highlightsVi: [
      "Bữa cơm gia đình, chuyến đi chơi cùng người thân.",
      "Chia sẻ, lắng nghe và gắn kết các thế hệ.",
    ],
    highlightsEn: [
      "Family meals and outings.",
      "Listening, sharing and bonding across generations.",
    ],
  },
  fathers_day: {
    originVi: "Chủ nhật thứ ba của tháng 6 · Ngày của Cha",
    originEn: "Third Sunday of June · Father's Day",
    summaryVi:
      "Dịp tri ân người cha và những người đàn ông đã luôn che chở, dìu dắt và làm điểm tựa cho gia đình.",
    summaryEn:
      "A day to thank fathers and father figures who protect, guide and support their families.",
    highlightsVi: [
      "Tặng quà, thiệp và dành thời gian bên cha.",
      "Gửi lời cảm ơn và những lời chúc ấm áp.",
    ],
    highlightsEn: [
      "Gifts, cards and time spent together.",
      "Warm thanks and wishes.",
    ],
  },
  vu_lan: {
    originVi: "15/07 Âm lịch · Lễ Vu Lan báo hiếu",
    originEn: "15th day of the 7th lunar month · Vu Lan",
    summaryVi:
      "Vu Lan là mùa báo hiếu của người Việt: tưởng nhớ công ơn cha mẹ và tổ tiên, gắn với nghi thức cài hoa hồng lên áo.",
    summaryEn:
      "Vietnam's season of filial piety: honouring parents and ancestors, known for the custom of wearing a rose.",
    highlightsVi: [
      "Cài hoa hồng: hồng đỏ khi còn mẹ, hồng trắng khi mẹ đã khuất.",
      "Đi chùa, cúng dường và làm việc thiện.",
    ],
    highlightsEn: [
      "Wearing a rose: red if your mother is living, white in remembrance.",
      "Temple visits, offerings and charity.",
    ],
  },
  august_revolution: {
    originVi: "19/08/1945 · Cách mạng tháng Tám thành công",
    originEn: "August 19, 1945 · August Revolution",
    summaryVi:
      "Kỷ niệm ngày nhân dân Hà Nội giành chính quyền, mở đầu cho thắng lợi của Cách mạng tháng Tám năm 1945.",
    summaryEn:
      "Marks the day Hanoi's people seized power, opening the victory of the 1945 August Revolution.",
    highlightsVi: [
      "Treo cờ, tổ chức lễ kỷ niệm và triển lãm lịch sử.",
      "Ôn lại truyền thống yêu nước của dân tộc.",
    ],
    highlightsEn: [
      "Flags, ceremonies and history exhibitions.",
      "Reflecting on the nation's patriotic tradition.",
    ],
  },
  entrepreneurs_day: {
    originVi: "13/10 hằng năm · Ngày Doanh nhân Việt Nam",
    originEn: "October 13 annually · Vietnam Entrepreneurs' Day",
    summaryVi:
      "Ngày tôn vinh các doanh nhân, doanh nghiệp đã đóng góp cho phát triển kinh tế và việc làm của đất nước.",
    summaryEn:
      "Honours entrepreneurs and businesses for their contribution to economic growth and jobs.",
    highlightsVi: [
      "Gặp mặt, trao giải doanh nhân tiêu biểu.",
      "Chia sẻ kinh nghiệm khởi nghiệp và đổi mới.",
    ],
    highlightsEn: [
      "Gatherings and awards for outstanding entrepreneurs.",
      "Sharing start-up and innovation experience.",
    ],
  },
  teachers_day: {
    originVi: "20/11 hằng năm · Ngày Nhà giáo Việt Nam",
    originEn: "November 20 annually · Vietnamese Teachers' Day",
    summaryVi:
      "Ngày tri ân thầy cô giáo, những người dạy dỗ và truyền cảm hứng học tập cho nhiều thế hệ học trò.",
    summaryEn:
      "A day to thank teachers who educate and inspire generation after generation of students.",
    highlightsVi: [
      "Tặng hoa, thiệp và lời chúc tới thầy cô.",
      "Họp mặt, văn nghệ và tri ân người thầy.",
    ],
    highlightsEn: [
      "Flowers, cards and wishes for teachers.",
      "Reunions, performances and gratitude.",
    ],
  },
  thanksgiving: {
    originVi: "Thứ Năm thứ tư của tháng 11 · Lễ Tạ ơn",
    originEn: "Fourth Thursday of November · Thanksgiving",
    summaryVi:
      "Lễ Tạ ơn là dịp quây quần, bày tỏ lòng biết ơn với những điều tốt đẹp trong năm, phổ biến nhất ở Hoa Kỳ.",
    summaryEn:
      "A time to gather and give thanks for the year's blessings, most widely observed in the United States.",
    highlightsVi: [
      "Bữa tiệc gia đình với gà tây và bánh bí ngô.",
      "Viết lời cảm ơn và chia sẻ với cộng đồng.",
    ],
    highlightsEn: [
      "A family feast with turkey and pumpkin pie.",
      "Writing thank-yous and giving back.",
    ],
  },
  kitchen_gods: {
    originVi: "23/12 Âm lịch · Ông Công, Ông Táo",
    originEn: "23rd day of the 12th lunar month · Kitchen Gods' Day",
    summaryVi:
      "Theo tục xưa, Táo quân cưỡi cá chép lên trời báo cáo việc nhà với Ngọc Hoàng; gia đình cúng tiễn để cầu một năm mới bình an.",
    summaryEn:
      "Folklore says the Kitchen Gods ride carp to heaven to report on each household; families make offerings for a peaceful new year.",
    highlightsVi: [
      "Cúng mũ áo, hoa quả, thả cá chép tiễn Táo quân.",
      "Dọn dẹp bếp núc, chuẩn bị đón Tết.",
    ],
    highlightsEn: [
      "Offerings and releasing carp to send off the Kitchen Gods.",
      "Cleaning the kitchen and preparing for Tết.",
    ],
  },
};
