import type { Locale } from "@/lib/i18n/core";

/**
 * The personal-data notice shown at /privacy, in both languages.
 *
 * Every statement here describes what this codebase actually stores and sends;
 * when a feature changes what is collected, kept or shared, change this text in
 * the same commit. The organisation that runs an instance is the data
 * controller, so the text speaks about "the organisation operating {siteName}"
 * rather than about WikiHub's authors, who never receive anyone's data.
 */

export interface PolicySection {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
  /** Shown after the items. */
  closing?: string[];
}

/** One row of the summary table above the full notice. */
export interface PolicyHighlight {
  title: string;
  text: string;
}

export interface PrivacyPolicyCopy {
  title: string;
  /** Small label above the title, naming the kind of document. */
  eyebrow: string;
  highlights: PolicyHighlight[];
  summaryLabel: string;
  tocLabel: string;
  /** The laws this notice is given under, shown at its foot. */
  legalBasis: string;
  appliesLabel: string;
  appliesTo: string;
  summary: string;
  updatedLabel: string;
  sections: PolicySection[];
  contactAction: string;
  accountAction: string;
}

/** The date this notice last changed in substance. */
export const POLICY_UPDATED = "2026-11-03";

const en = (siteName: string): PrivacyPolicyCopy => ({
  title: "Personal data notice",
  summary: `How ${siteName} collects, uses and protects your personal data, and how to exercise your rights over it.`,
  updatedLabel: "Last updated",
  contactAction: "Contact an administrator",
  accountAction: "Open account settings",
  tocLabel: "Contents",
  eyebrow: "Legal",
  summaryLabel: "Summary",
  appliesLabel: "Applies to",
  appliesTo: `Everyone who uses ${siteName}`,
  legalBasis:
    "This notice is provided under Vietnam's Law on Personal Data Protection (Law No. 91/2025/QH15) and Decree 356/2025/ND-CP.",
  highlights: [
    {
      title: "What we collect",
      text: "Your account, profile, sign-in sessions and what you write.",
    },
    {
      title: "Never sold or tracked",
      text: "No advertising, no analytics, no tracking cookies.",
    },
    {
      title: "Kept only as needed",
      text: "Unanswered AI questions are deleted after 90 days.",
    },
    {
      title: "Your rights",
      text: "Ask to see, correct or delete your data at any time.",
    },
  ],
  sections: [
    {
      id: "controller",
      title: "Who is responsible",
      paragraphs: [
        `${siteName} is run by the organisation that installed and administers it. That organisation decides why and how your personal data is processed, and is responsible for it. ${siteName} is built on WikiHub, open-source software installed on infrastructure the organisation controls; the WikiHub project does not receive your data.`,
      ],
    },
    {
      id: "data",
      title: "What we collect",
      items: [
        "Account: username, e-mail address, full name, role and permissions. Your password is stored only as an Argon2 hash, never in readable form.",
        "Profile, if you fill it in: profile picture, bio, pronouns, company, profile URL and social links.",
        "What you create: pages, comments, version history, attachments, likes, pinned pages and your private labels.",
        "Sign-in sessions: IP address, browser (user agent), sign-in time and last activity.",
        "Activity log: administrative actions such as creating users or changing permissions, with the IP address and browser they came from.",
        "Usage statistics: how long you use the app each day, how many AI tokens your requests used, and view counts for pages and spaces (counts are not linked to who viewed).",
        "AI assistant: the questions you ask. A question the wiki could not answer is kept with your identity so you can be told once a page answers it.",
        "Requests to administrators: the name, e-mail address, message and IP address you send through the contact form.",
      ],
    },
    {
      id: "purposes",
      title: "Why we use it",
      items: [
        "To provide the wiki: sign you in, show your work, apply permissions and send you notifications.",
        "To keep the system secure and accountable: detect misuse, investigate incidents and show who changed what.",
        "To answer your questions with the AI assistant and help administrators fill gaps in the documentation.",
        "To respond to requests you send to administrators.",
      ],
      closing: [
        "Your data is not sold, not used for advertising and not shared with analytics or tracking services.",
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      items: [
        "Account and profile: until your account is deleted.",
        "Pages and comments you wrote: they are shared team documentation, so they remain after your account is deleted, without your account attached.",
        "Unanswered AI questions: 90 days.",
        "Conversations with the AI assistant: in your own browser only, until you clear them.",
        "Sign-in sessions, the activity log and usage statistics: kept so actions stay accountable. The activity log keeps your username after your account is deleted.",
      ],
    },
    {
      id: "sharing",
      title: "Who else receives it",
      items: [
        "AI services: by default the assistant runs on the organisation's own servers. If an administrator connects an external AI service, your questions and the relevant page content are sent to it, and that service may be located outside Vietnam.",
        "Web search, if enabled: only a short search query leaves the system, with IP addresses, e-mail addresses and passwords removed. Pages and your full question are never sent.",
        "E-mail: notifications are sent through the mail server your administrators configure.",
        "Public share links: anyone holding a link can read the page it points to until the link expires or is revoked.",
        "Authorities: only where the law requires it.",
      ],
    },
    {
      id: "impersonation",
      title: "When an administrator uses your account",
      paragraphs: [
        "To help with support or to check permissions, an administrator can view the wiki as you. Each time, the activity log records which administrator did it, and you receive a notification. The administrator cannot see or dismiss that notification while using your account.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies and browser storage",
      paragraphs: [
        "Only cookies needed for the app to work are used: your sign-in session, your language and the sidebar layout. Your browser also stores preferences, unsaved drafts, recently visited pages and AI conversations locally. There are no advertising or analytics cookies, so none of this needs a consent banner.",
      ],
    },
    {
      id: "security",
      title: "How it is protected",
      paragraphs: [
        "Passwords are hashed with Argon2, stored mail-server passwords are encrypted, access to every space and page is governed by permissions, and administrative actions are logged. If a breach affects personal data, the organisation notifies the competent authority within 72 hours as the law requires, and tells you when you are affected.",
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      paragraphs: [
        "Under Vietnam's Law on Personal Data Protection (Law No. 91/2025/QH15) and Decree 356/2025/ND-CP, you have the right to know how your data is processed, to see, correct and obtain a copy of it, to have it deleted, to restrict or object to processing, to withdraw consent, and to complain.",
        "You can update your profile, change your password and end sign-in sessions yourself in Account settings. For anything else, contact an administrator: they will reply within 2 working days and handle the request within the time limits the law sets.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this notice",
      paragraphs: [
        "When what we collect or how we use it changes, this page is updated and its date changes with it.",
      ],
    },
  ],
});

const vi = (siteName: string): PrivacyPolicyCopy => ({
  title: "Thông báo xử lý dữ liệu cá nhân",
  summary: `Cách ${siteName} thu thập, sử dụng, bảo vệ dữ liệu cá nhân của bạn và cách bạn thực hiện các quyền của mình.`,
  updatedLabel: "Cập nhật lần cuối",
  contactAction: "Liên hệ quản trị viên",
  accountAction: "Mở cài đặt tài khoản",
  tocLabel: "Mục lục",
  eyebrow: "Pháp lý",
  summaryLabel: "Tóm tắt",
  appliesLabel: "Phạm vi áp dụng",
  appliesTo: `Mọi người dùng ${siteName}`,
  legalBasis:
    "Thông báo này được đưa ra theo Luật Bảo vệ dữ liệu cá nhân (Luật số 91/2025/QH15) và Nghị định 356/2025/NĐ-CP.",
  highlights: [
    {
      title: "Dữ liệu thu thập",
      text: "Tài khoản, hồ sơ, phiên đăng nhập và nội dung bạn viết.",
    },
    {
      title: "Không bán, không theo dõi",
      text: "Không quảng cáo, không phân tích, không cookie theo dõi.",
    },
    {
      title: "Chỉ giữ khi cần",
      text: "Câu hỏi AI chưa trả lời được xoá sau 90 ngày.",
    },
    {
      title: "Quyền của bạn",
      text: "Yêu cầu xem, sửa hoặc xoá dữ liệu bất cứ lúc nào.",
    },
  ],
  sections: [
    {
      id: "controller",
      title: "Ai chịu trách nhiệm",
      paragraphs: [
        `${siteName} do tổ chức đã cài đặt và quản trị hệ thống này vận hành. Tổ chức đó quyết định mục đích, cách thức xử lý dữ liệu cá nhân của bạn và chịu trách nhiệm về việc này. ${siteName} được xây dựng trên WikiHub, phần mềm mã nguồn mở cài đặt trên hạ tầng do tổ chức kiểm soát; dự án WikiHub không nhận dữ liệu của bạn.`,
      ],
    },
    {
      id: "data",
      title: "Dữ liệu được thu thập",
      items: [
        "Tài khoản: tên đăng nhập, email, họ tên, vai trò và quyền. Mật khẩu chỉ được lưu ở dạng băm Argon2, không bao giờ ở dạng đọc được.",
        "Hồ sơ, nếu bạn tự điền: ảnh đại diện, giới thiệu, danh xưng, công ty, đường dẫn hồ sơ và liên kết mạng xã hội.",
        "Nội dung bạn tạo: page, bình luận, lịch sử version, tệp đính kèm, lượt thích, page đã ghim và nhãn riêng.",
        "Phiên đăng nhập: địa chỉ IP, trình duyệt (user agent), thời điểm đăng nhập và hoạt động gần nhất.",
        "Nhật ký hoạt động: các thao tác quản trị như tạo người dùng hay đổi quyền, kèm địa chỉ IP và trình duyệt thực hiện.",
        "Thống kê sử dụng: thời gian bạn dùng ứng dụng mỗi ngày, số token AI các yêu cầu của bạn đã dùng, và số lượt xem page, space (lượt xem không gắn với người xem).",
        "Trợ lý AI: câu hỏi bạn gửi. Câu hỏi mà wiki chưa trả lời được sẽ được lưu kèm danh tính của bạn để báo lại khi đã có page trả lời.",
        "Yêu cầu gửi quản trị viên: họ tên, email, nội dung và địa chỉ IP bạn gửi qua biểu mẫu liên hệ.",
      ],
    },
    {
      id: "purposes",
      title: "Mục đích sử dụng",
      items: [
        "Cung cấp wiki: đăng nhập, hiển thị nội dung của bạn, áp dụng phân quyền và gửi thông báo.",
        "Bảo đảm an toàn và trách nhiệm giải trình: phát hiện lạm dụng, điều tra sự cố và biết ai đã thay đổi gì.",
        "Trả lời câu hỏi bằng trợ lý AI và giúp quản trị viên bổ sung tài liệu còn thiếu.",
        "Phản hồi các yêu cầu bạn gửi quản trị viên.",
      ],
      closing: [
        "Dữ liệu của bạn không bị mua bán, không dùng cho quảng cáo và không được chia sẻ với dịch vụ phân tích hay theo dõi nào.",
      ],
    },
    {
      id: "retention",
      title: "Thời gian lưu trữ",
      items: [
        "Tài khoản và hồ sơ: đến khi tài khoản bị xoá.",
        "Page và bình luận bạn viết: là tài liệu chung của nhóm nên vẫn được giữ sau khi tài khoản bị xoá, nhưng không còn gắn với tài khoản của bạn.",
        "Câu hỏi AI chưa được trả lời: 90 ngày.",
        "Cuộc trò chuyện với trợ lý AI: chỉ lưu trong trình duyệt của bạn, đến khi bạn xoá.",
        "Phiên đăng nhập, nhật ký hoạt động và thống kê sử dụng: được giữ để bảo đảm trách nhiệm giải trình. Nhật ký hoạt động vẫn giữ tên đăng nhập của bạn sau khi tài khoản bị xoá.",
      ],
    },
    {
      id: "sharing",
      title: "Bên nhận dữ liệu",
      items: [
        "Dịch vụ AI: mặc định trợ lý chạy trên máy chủ của chính tổ chức. Nếu quản trị viên kết nối dịch vụ AI bên ngoài, câu hỏi của bạn và nội dung page liên quan sẽ được gửi tới dịch vụ đó, và dịch vụ này có thể đặt ở ngoài Việt Nam.",
        "Tìm kiếm web, nếu được bật: chỉ một câu truy vấn ngắn rời khỏi hệ thống, đã loại bỏ địa chỉ IP, email và mật khẩu. Nội dung page và nguyên văn câu hỏi không bao giờ được gửi đi.",
        "Email: thông báo được gửi qua máy chủ thư do quản trị viên cấu hình.",
        "Link chia sẻ công khai: bất kỳ ai có link đều đọc được page đó cho tới khi link hết hạn hoặc bị thu hồi.",
        "Cơ quan nhà nước: chỉ khi pháp luật yêu cầu.",
      ],
    },
    {
      id: "impersonation",
      title: "Khi quản trị viên dùng tài khoản của bạn",
      paragraphs: [
        "Để hỗ trợ hoặc kiểm tra phân quyền, quản trị viên có thể xem wiki dưới danh nghĩa của bạn. Mỗi lần như vậy, nhật ký hoạt động ghi lại quản trị viên nào đã làm, và bạn nhận được một thông báo. Trong lúc dùng tài khoản của bạn, quản trị viên không thể xem hay ẩn thông báo đó.",
      ],
    },
    {
      id: "cookies",
      title: "Cookie và bộ nhớ trình duyệt",
      paragraphs: [
        "Chỉ dùng cookie cần thiết để ứng dụng hoạt động: phiên đăng nhập, ngôn ngữ và bố cục thanh bên. Trình duyệt của bạn cũng lưu tại chỗ các tuỳ chọn, bản nháp chưa lưu, page đã xem gần đây và cuộc trò chuyện AI. Không có cookie quảng cáo hay phân tích, vì vậy không cần banner xin đồng ý cookie.",
      ],
    },
    {
      id: "security",
      title: "Biện pháp bảo vệ",
      paragraphs: [
        "Mật khẩu được băm bằng Argon2, mật khẩu máy chủ thư được mã hoá khi lưu, mọi space và page đều được kiểm soát bằng phân quyền, và các thao tác quản trị đều được ghi nhật ký. Nếu xảy ra sự cố làm lộ dữ liệu cá nhân, tổ chức sẽ thông báo cho cơ quan có thẩm quyền trong vòng 72 giờ theo quy định và báo cho bạn nếu bạn bị ảnh hưởng.",
      ],
    },
    {
      id: "rights",
      title: "Quyền của bạn",
      paragraphs: [
        "Theo Luật Bảo vệ dữ liệu cá nhân (Luật số 91/2025/QH15) và Nghị định 356/2025/NĐ-CP, bạn có quyền được biết về việc xử lý dữ liệu của mình; xem, chỉnh sửa và nhận bản sao dữ liệu; yêu cầu xoá; hạn chế hoặc phản đối việc xử lý; rút lại sự đồng ý; và khiếu nại.",
        "Bạn có thể tự cập nhật hồ sơ, đổi mật khẩu và kết thúc phiên đăng nhập trong Cài đặt tài khoản. Với các yêu cầu khác, hãy liên hệ quản trị viên: họ sẽ phản hồi trong 2 ngày làm việc và xử lý yêu cầu trong thời hạn pháp luật quy định.",
      ],
    },
    {
      id: "changes",
      title: "Thay đổi thông báo này",
      paragraphs: [
        "Khi dữ liệu thu thập hoặc cách sử dụng thay đổi, trang này sẽ được cập nhật cùng với ngày cập nhật.",
      ],
    },
  ],
});

export function privacyPolicyCopy(
  locale: Locale,
  siteName: string,
): PrivacyPolicyCopy {
  return locale === "vi" ? vi(siteName) : en(siteName);
}
