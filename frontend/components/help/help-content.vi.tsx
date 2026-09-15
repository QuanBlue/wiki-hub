import { Code, Kbd, Quote, Screenshot, Callout, type HelpSection } from "./help-ui";

export const sectionsVi: HelpSection[] = [
  // ---------------------------------------------------------------------------
  // WORKSPACE CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "getting-started",
    title: "Bắt đầu & Điều hướng",
    category: "Workspace",
    description:
      "Đăng nhập, làm chủ thanh điều hướng, tìm kiếm toàn cục và các phím tắt của workspace.",
    keywords: ["login", "đăng nhập", "search", "tìm kiếm", "navigation", "điều hướng", "home", "trang chủ", "sidebar", "rail"],
    body: (
      <>
        <p>
          Chào mừng bạn đến với <strong>WikiHub</strong> - trung tâm tài liệu và tri
          thức nhóm. Để bắt đầu, hãy đăng nhập bằng tên đăng nhập hoặc địa chỉ email
          đã đăng ký của bạn.
        </p>

        <Screenshot
          src="/help/getting-started-home.png"
          alt="Bảng điều khiển Home, với thanh sidebar bên trái hiển thị Home, Spaces, Favorite spaces và Pinned pages"
          caption="Home, với thanh sidebar bên trái nằm ngay dưới thanh tìm kiếm."
        />

        <Callout variant="tip" title="PHÍM TẮT TÌM KIẾM NHANH">
          Nhấn <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> (hoặc <Kbd>⌘</Kbd> + <Kbd>K</Kbd> trên
          macOS) ở bất kỳ đâu trong ứng dụng để mở ngay <strong>Global Search</strong>.
          Gõ từ khoá, tên space, hoặc tiêu đề trang để chuyển thẳng đến bất kỳ tài
          liệu nào.
        </Callout>

        <Callout variant="note" title="TÌM KIẾM THỰC SỰ KHỚP VỚI NHỮNG GÌ">
          Tìm kiếm tìm văn bản của bạn bên trong tên/khoá/mô tả của space và tiêu
          đề/nội dung trang - đây là so khớp chuỗi con đơn giản, không phải tìm kiếm
          toàn văn có xếp hạng. Nó hiện chưa tìm trong tên tệp đính kèm hay nội dung
          tệp đính kèm, và chỉ hiển thị những kết quả bạn có quyền xem. Không có bộ
          lọc theo ngày, space, hay tác giả.
        </Callout>

        <p className="mt-3">
          <strong>Các vùng giao diện chính:</strong>
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Thanh điều hướng trên cùng</strong>: ô tìm kiếm (mở cùng một
            modal <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>), liên kết <strong>Help</strong>{" "}
            (biểu tượng quyển sách, đưa bạn đến đây), nút chuyển đổi giao diện
            Sáng/Tối, và menu người dùng của bạn. WikiHub không có chuông thông
            báo - chưa có hệ thống push/alert (xem ghi chú trong{" "}
            <em>Vận hành an toàn & Xử lý sự cố hệ thống</em>).
          </li>
          <li>
            <strong>Thanh sidebar bên trái</strong>: <strong>Home</strong> và{" "}
            <strong>Spaces</strong>, sau đó là danh sách <strong>Most visited</strong>{" "}
            của bạn - một danh sách tự động, xếp hạng theo server dựa trên những
            space bạn thực sự mở, không phải danh sách ghim thủ công - và, với
            admin, một mục <strong>Administration</strong>.
          </li>
          <li>
            <strong>Thu gọn Sidebar</strong>: nhấn nút thu gọn/mở rộng, hoặc kéo
            cạnh phải của sidebar qua khỏi độ rộng tối thiểu, để thu nhỏ về chỉ còn
            biểu tượng. Lựa chọn của bạn được ghi nhớ trên thiết bị này.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "keyboard-shortcuts",
    title: "Tra cứu phím tắt bàn phím",
    category: "Workspace",
    description:
      "Mọi phím tắt bàn phím mà WikiHub thực sự nhận diện, ở một chỗ.",
    keywords: ["keyboard", "bàn phím", "shortcut", "phím tắt", "hotkey", "ctrl", "cmd", "escape"],
    body: (
      <>
        <p>
          Không có command palette nào ngoài Search - chỉ có bộ phím tắt này. Những
          phím được đánh dấu <strong>Rebindable</strong> là mặc định mà bạn có thể
          thay đổi; xem <em>Tuỳ chỉnh phím tắt bàn phím</em> trong mục{" "}
          <strong>Account</strong>.
        </p>

        <div className="border-border bg-surface mt-3 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-40">Phím tắt</th>
                <th className="p-2.5">Ở đâu & làm gì</th>
                <th className="p-2.5 w-24">Rebindable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>K</Kbd></td>
                <td className="p-2.5">Ở bất kỳ đâu - mở hoặc đóng Global Search. Sau đó dùng <Kbd>↑</Kbd>/<Kbd>↓</Kbd> để di chuyển lựa chọn, <Kbd>Enter</Kbd> để mở, <Kbd>Esc</Kbd> để đóng.</td>
                <td className="p-2.5">Có</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>F</Kbd></td>
                <td className="p-2.5">Một cách khác để mở Global Search, thay cho thanh tìm kiếm của trình duyệt. Bên trong bản xem trước tệp văn bản hoặc code, nó sẽ lấy tiêu điểm vào ô <strong>Search content</strong> của bản xem trước đó, để bạn tìm trong chính tệp đang xem.</td>
                <td className="p-2.5">Có</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>S</Kbd></td>
                <td className="p-2.5">Khi đang chỉnh sửa trang - lưu ngay lập tức, chặn hộp thoại Save-page mặc định của trình duyệt.</td>
                <td className="p-2.5">Có</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>R</Kbd></td>
                <td className="p-2.5">Khi đang chỉnh sửa - được chặn lại để hỏi <em>&ldquo;Reload site?&rdquo;</em> thay vì âm thầm bỏ các thay đổi chưa lưu.</td>
                <td className="p-2.5">Có</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Space</Kbd></td>
                <td className="p-2.5">Trong bản xem trước video - phát hoặc tạm dừng, từ bất kỳ đâu trong bản xem trước chứ không chỉ khi trình phát đang được focus. Bị bỏ qua khi một nút hoặc ô nhập liệu đang được focus, nên không bao giờ chiếm phím của phần tử khác.</td>
                <td className="p-2.5">Có</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>/</Kbd></td>
                <td className="p-2.5">Đầu một dòng trống trong trình soạn thảo - mở menu slash command (xem <em>Slash Commands</em>).</td>
                <td className="p-2.5">Không</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>←</Kbd> / <Kbd>→</Kbd></td>
                <td className="p-2.5">Trong bản xem trước tệp PowerPoint - slide trước/tiếp theo (hoạt động cả bên trong lẫn bên ngoài chế độ Present toàn màn hình).</td>
                <td className="p-2.5">Không</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Esc</Kbd></td>
                <td className="p-2.5">Đóng lớp phủ (overlay) đang được focus - một dialog, ngăn kéo sidebar trên di động, hoặc (được kiểm tra trước) chỉ riêng slideshow PowerPoint mà không đóng cửa sổ tệp đính kèm chứa nó.</td>
                <td className="p-2.5">Không</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "spaces",
    title: "Spaces, Quyền truy cập & Vai trò",
    category: "Workspace",
    description:
      "Tạo space cho nhóm, gán vai trò, quản lý khả năng hiển thị và ghim mục yêu thích.",
    keywords: [
      "favourite",
      "favorite",
      "yêu thích",
      "members",
      "thành viên",
      "visibility",
      "hiển thị",
      "archive",
      "lưu trữ",
      "layers",
      "permissions",
      "quyền",
      "roles",
      "vai trò",
    ],
    body: (
      <>
        <p>
          Một <strong>Space</strong> là một khu vực tri thức riêng cho một nhóm,
          phòng ban hoặc dự án cụ thể. Mọi trang trong WikiHub đều thuộc về một
          space.
        </p>

        <Screenshot
          src="/help/spaces-directory.png"
          alt="Danh bạ Spaces, được lọc theo một truy vấn tìm kiếm, hiển thị chủ sở hữu, ngày tạo, khả năng hiển thị, số lượng thành viên/nhóm của từng space, và nút Edit"
          caption="Danh bạ Spaces - tìm kiếm, các tab All/Favorite/Own, và nút Edit trên mỗi dòng."
        />

        <Quote>
          &ldquo;Spaces giữ cho tài liệu của nhóm được tổ chức và tách biệt bằng các
          quy tắc truy cập riêng, quyền thành viên, và khoá space duy nhất.&rdquo;
        </Quote>

        <p className="mt-4 font-semibold text-foreground">
          Các khả năng quản lý Space:
        </p>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            <strong>Tạo một Space</strong>: Người dùng có quyền tạo space có thể
            nhấn <strong>Create Space</strong> trong danh bạ Spaces. Chỉ định một{" "}
            <strong>Space Key</strong> duy nhất (vd: <Code>ENG</Code>,{" "}
            <Code>PRODUCT</Code>), tên space, mô tả, và emoji hoặc biểu tượng vector
            tuỳ chỉnh.
          </li>
          <li>
            <strong>Khả năng hiển thị của Space</strong> (đặt từ{" "}
            <strong>Edit space &gt; Access &amp; Permissions</strong>):
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <strong className="text-success">Open</strong>: mọi người dùng đã
                đăng nhập tự động có toàn quyền đọc <em>và</em> ghi -{" "}
                <Code>View</Code>, <Code>Add/Edit</Code>, <Code>Delete</Code>,{" "}
                <Code>Delete own</Code> và <Code>Move</Code> - không cần cấp riêng
                cho từng người. Hai quyền có thể cấu hình lại chính space,{" "}
                <Code>Admin</Code> và <Code>Restrictions</Code>, không bao giờ được
                cấp miễn phí ở chế độ nào - chỉ Owner của space hoặc người được
                thăng cấp rõ ràng mới có.
              </li>
              <li>
                <strong className="text-danger">Restricted</strong>: mặc định
                không ai có gì cả - các bảng quyền bên dưới trở thành nguồn duy
                nhất quyết định ai có thể xem, sửa, xoá hoặc di chuyển bất cứ thứ
                gì.
              </li>
            </ul>
            Chuyển đổi giữa hai chế độ diễn ra ngay lập tức và không phá huỷ dữ
            liệu: các bảng quyền của một space Restricted vẫn giữ nguyên cấu hình
            trong khi space ở chế độ Open, nên việc bật/tắt qua lại không bao giờ
            có nghĩa là phải xây dựng lại từ đầu.
          </li>
          <li>
            <strong>Space Owner</strong>: mỗi space luôn có ít nhất một Owner
            (mặc định là người tạo) - một Administrator được bảo vệ, không thể bị
            xoá xuống còn 0, để một space không bao giờ rơi vào tình trạng không
            ai quản lý được dù bảng quyền bên dưới thế nào. Quản lý danh sách này
            từ <strong>Edit space &gt; General</strong>; chỉ một Owner hiện có mới
            có thể thêm hoặc xoá Owner khác. Một space có thể có nhiều Owner cùng
            lúc, và mỗi Owner đều bỏ qua mọi giới hạn ở cấp trang giống như quyền{" "}
            <Code>Admin</Code>.
          </li>
          <li>
            <strong>Quyền theo từng user & từng nhóm</strong>: thay vì một danh
            sách vai trò cố định, WikiHub cấp trực tiếp các khả năng cụ thể cho
            một user hoặc một nhóm - <Code>View</Code>, <Code>Add/Edit</Code>,{" "}
            <Code>Delete</Code>, <Code>Delete own</Code>, <Code>Restrictions</Code>
            , <Code>Move</Code>, và <Code>Admin</Code> - từ tab{" "}
            <strong>Edit space &gt; Access &amp; Permissions</strong> của chính
            space đó, hoặc từ <strong>Administration &gt; Spaces</strong> (xem{" "}
            <em>Quyền truy cập Space & Quyền hiệu lực</em> để biết bức tranh đầy
            đủ, bao gồm cách kiểm tra quyền đã phân giải của bất kỳ ai). Xuất trang
            tự động theo <Code>View</Code>, không cần cấp riêng. Khi space đang ở
            chế độ Open, các bảng hiển thị <Code>All</Code> thay vì ô checkbox cho
            năm quyền mà Open đã cấp sẵn cho mọi người - <Code>Admin</Code> và{" "}
            <Code>Restrictions</Code> vẫn là checkbox sống bất kể chế độ nào, vì
            đó là cách duy nhất để ai đó trở thành Admin hoặc thu hẹp phạm vi ai
            được giới hạn một trang.
          </li>
          <li>
            <strong>Một quyền cấp trực tiếp ghi đè quyền của nhóm, chứ không cộng
            thêm</strong>: các nhóm bạn thuộc về vẫn kết hợp với nhau như bình
            thường, nhưng ngay khi một user có dòng quyền <em>riêng</em> của mình
            trên một space, dòng đó sẽ quyết định mọi thứ cho họ - tư cách thành
            viên nhóm không còn đóng góp gì thêm. Đây là cách một thành viên trong
            một nhóm rộng (ví dụ mọi người đều có <Code>Add/Edit</Code>) có thể bị
            thu hẹp chỉ còn <Code>View</Code>, bằng cách cấp cho người đó một dòng
            quyền riêng nhỏ hơn. <Code>Admin</Code> là ngoại lệ duy nhất: quyền{" "}
            <Code>Admin</Code> của một nhóm luôn được áp dụng, để một space không
            bao giờ bị khoá mà không có admin nào tiếp cận được.
          </li>
          <li>
            <strong>Chỉnh sửa một space</strong>: nhấn <strong>Edit space</strong>{" "}
            (biểu tượng bút chì ở chân sidebar của space, chỉ admin) để có ba tab:{" "}
            <strong>General</strong> (tên, Space Owner, và giới hạn kích thước tệp
            đính kèm tuỳ chọn theo space, ghi đè mặc định của workspace),{" "}
            <strong>Access &amp; Permissions</strong> (General access cộng các
            bảng ở trên), và <strong>Space settings &amp; Danger zone</strong> (Lưu
            trữ/Khôi phục space, hoặc Xoá vĩnh viễn - xoá vĩnh viễn chỉ khả dụng từ{" "}
            <strong>Administration &gt; Spaces</strong>, không phải ở đây).
          </li>
          <li>
            <strong>Đánh dấu yêu thích</strong>: Nhấn biểu tượng <Code>★ Star</Code>{" "}
            trên tiêu đề của space để thêm vào mục yêu thích. Các space đã đánh
            dấu yêu thích xuất hiện trong <strong>My favorite spaces</strong> ở
            trang Home, và trong tab <strong>Favorite</strong> của danh bạ Spaces (
            <Code>/spaces?tab=starred</Code>). Tab <strong>Own</strong> của danh
            bạ lại khác - nó liệt kê các space <em>bạn sở hữu</em> (xem Space Owner
            ở trên), không phải các space bạn đã đánh dấu sao.
            <br />
            Danh sách <strong>Most visited</strong> riêng của sidebar là tự động
            và độc lập - nó xếp hạng những space bạn thực sự mở nhiều nhất, không
            liên quan đến những gì bạn đã đánh dấu sao.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "my-work",
    title: "Tìm các trang bạn đã ghé thăm, chỉnh sửa hoặc lưu",
    category: "Workspace",
    description:
      "Ba màn hình hoạt động cá nhân cho lịch sử của riêng bạn - chưa có trong sidebar, nhưng chỉ cách một URL.",
    keywords: [
      "recently visited",
      "recently worked on",
      "history",
      "lịch sử",
      "my work",
      "saved",
      "đã lưu",
      "activity",
      "hoạt động",
    ],
    body: (
      <>
        <p>
          Ngoài luồng hoạt động toàn workspace trên <strong>Home</strong>, WikiHub
          còn giữ ba màn hình lịch sử cá nhân của riêng bạn:
        </p>

        <Callout variant="note" title="CHƯA ĐƯỢC LIÊN KẾT TỪ SIDEBAR">
          Các trang này đã tồn tại và hoạt động ngay hôm nay, nhưng chưa có mục
          menu nào trỏ đến chúng - hãy đánh dấu (bookmark) trang nào bạn dùng.
        </Callout>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>
              Recently visited <Code>/recent/visited</Code>
            </strong>
            : các trang bạn đã mở trên thiết bị này, mới nhất trước. Chỉ lưu trong
            trình duyệt này, giống <Code>Save for later</Code> bên dưới.
          </li>
          <li>
            <strong>
              Recently worked on <Code>/recent/worked-on</Code>
            </strong>
            : các trang bạn đã tự tạo hoặc chỉnh sửa. Danh sách này được lấy từ
            server, nên giống nhau trên mọi thiết bị bạn đăng nhập.
          </li>
          <li>
            <strong>
              Saved for later <Code>/saved</Code>
            </strong>
            : mọi thứ bạn đã đánh dấu bằng nút <Code>Save for later</Code> (xem{" "}
            <em>Thích, lưu & chia sẻ một trang</em> bên dưới).
          </li>
        </ul>

        <p className="mt-3 text-sm">
          Bản thân <strong>Home</strong> (logo, hoặc <strong>Home</strong> trong
          sidebar) hiển thị một góc nhìn khác, cho toàn workspace:{" "}
          <strong>All updates</strong> - mọi trang mà bất kỳ ai đã chỉnh sửa, được
          nhóm theo tác giả - cùng với các space yêu thích của bạn ở bảng bên
          phải.
        </p>
      </>
    ),
  },
  {
    id: "page-engagement",
    title: "Thích, lưu & chia sẻ một trang",
    category: "Workspace",
    description:
      "Đánh dấu các trang hữu ích, lưu những trang bạn sẽ cần lại, và khoá riêng một trang nhạy cảm.",
    keywords: [
      "like",
      "thích",
      "save for later",
      "share",
      "chia sẻ",
      "bookmark",
      "page access",
      "restrict",
      "restriction",
      "giới hạn",
    ],
    body: (
      <>
        <p>
          Bên dưới tiêu đề của một trang, thanh công cụ của trang mang theo một số
          thao tác nhỏ, tách biệt với việc chỉnh sửa:
        </p>

        <Screenshot
          src="/help/page-engagement-row.png"
          alt="Đầu một trang: breadcrumb, tiêu đề, các nút Create/Edit/Save for later/Pin page/Share, và nút Like ngay dưới tiêu đề"
          caption="Create/Edit/Save for later/Pin page/Share ở trên cùng, Like ngay dưới tiêu đề."
        />

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Like</strong>: nhấn <Code>Like</Code> để đánh dấu một trang là
            hữu ích. Số lượt thích hiển thị cho mọi người và nút chuyển thành{" "}
            <Code>Liked</Code> đối với bạn - một tín hiệu nhẹ nhàng cho biết nội
            dung nào thực sự được đọc, không phải công cụ kiểm duyệt.
          </li>
          <li>
            <strong>Save for later</strong>: nhấn nút ngôi sao{" "}
            <Code>Save for later</Code> để đánh dấu một trang.
            <Callout variant="important" title="CHỈ TRÊN THIẾT BỊ NÀY">
              Trạng thái Saved-for-later được lưu trong trình duyệt này, không
              phải tài khoản của bạn - lưu trên laptop sẽ không hiện trên điện
              thoại, và xoá dữ liệu trình duyệt cũng xoá luôn. Mọi thứ bạn đã lưu
              được liệt kê tại <Code>/saved</Code>.
            </Callout>
          </li>
          <li>
            <strong>Share</strong>: nhấn <Code>Share</Code> để sao chép liên kết
            trực tiếp của trang vào clipboard, sẵn sàng dán vào chat hoặc email.
          </li>
          <li>
            <strong>Page access</strong>: trên một trang bạn có thể quản lý, nhấn{" "}
            <Code>Page access</Code> để mở cài đặt <strong>General access</strong>{" "}
            - <Code>Open</Code> hoặc <Code>Restricted</Code> - cùng bảng bên dưới,
            trông khác nhau tuỳ vào lựa chọn:
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
              <li>
                <strong>Open</strong> (mặc định) liệt kê mọi người và mọi nhóm mà
                space đã cấp quyền truy cập, với quyền View/Edit hiện tại của họ
                đối với trang này được đánh dấu sẵn - không cần tìm kiếm hay thêm
                gì. Bỏ đánh dấu một ô chỉ chặn riêng người hoặc nhóm đó; mọi người
                khác không bị ảnh hưởng. Edit bị làm mờ với bất kỳ ai mà vai trò
                trong space của họ không bao gồm quyền đó, vì một giới hạn trang
                chỉ thu hẹp ai được sửa trong số những người space đã cho phép sửa
                - nó không bao giờ cấp thêm quyền sửa ngoài phạm vi đó. Cả View và
                Edit đều bị làm mờ (và đánh dấu sẵn) đối với một Admin của space,
                vì Admin bỏ qua mọi giới hạn ở cấp trang - chặn ở đây sẽ không có
                tác dụng gì, nên ô đó bị khoá thay vì đưa ra một điều khiển vô
                nghĩa.
              </li>
              <li>
                <strong>Restricted</strong> thay vào đó bắt đầu từ một danh sách
                cho phép trống, bạn tự xây dựng bằng cách tìm và thêm người hoặc
                nhóm cụ thể - giới hạn xem sẽ kế thừa xuống các trang con, và bất
                kỳ ai không được thêm vào sẽ không thể thấy trang này, bất kể vai
                trò của họ trong space.
              </li>
            </ul>
            <Callout variant="tip" title="Cả hai bảng đều mở ở chế độ chỉ đọc">
              Không bảng nào có thể nhấn được checkbox cho đến khi bạn nhấn nút{" "}
              <Code>Edit</Code> riêng của bảng đó - một cú nhấn nhầm không thể thay
              đổi quyền của ai. Nhấn <Code>Done</Code> khi bạn hoàn tất với bảng đó
              để khoá lại.
            </Callout>
            <Callout variant="tip" title="Chuyển chế độ không bao giờ xoá thiết lập của chế độ kia">
              Bật/tắt General access bao nhiêu lần tuỳ thích - danh sách cho phép
              Restricted hoặc các chặn Open bạn đã cấu hình sẽ luôn quay lại y
              nguyên mỗi lần, thay vì phải xây dựng lại từ đầu. <Code>Reset to
              default</Code> (có xác nhận trước) là cách chủ động để thực sự xoá
              chế độ đang hoạt động: Restricted đặt lại về danh sách cho phép
              trống, Open xoá mọi chặn.
            </Callout>
            <Callout variant="important" title="Bộ chọn của Restricted chỉ hiện người đã có trong space">
              Nó chỉ cho phép bạn tìm và chọn người hoặc nhóm mà space đã cấp
              quyền truy cập - giới hạn một trang cho ai đó còn bị chặn ngay từ
              cửa space sẽ chẳng làm được gì ngoài gây nhầm lẫn. Bất kỳ ai khác bạn
              tìm vẫn hiện ra, bị làm mờ và đánh dấu <Code>Not added to space</Code>
              ; hãy thêm họ vào <em>Access &amp; Permissions</em> của space trước,
              rồi quay lại đây. Nếu ai đó sau này bị xoá khỏi space hoàn toàn, mọi
              giới hạn hoặc chặn ở cấp trang nhắc đến họ sẽ được dọn dẹp tự động.
            </Callout>
          </li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: một space vẫn mở cho cả nhóm, nhưng riêng trang ghi
          lại phân tích sự cố (postmortem) hoặc chính sách lương thưởng được
          chuyển sang <Code>Restricted</Code> và giới hạn chỉ cho những người cần.
          Hoặc ngược lại - một trang vẫn <Code>Open</Code>, nhưng một người không
          nên thấy nó (một quản lý đang xem phản hồi về chính họ) - nên chỉ cần bỏ
          đánh dấu View của riêng người đó.
        </p>
      </>
    ),
  },
  {
    id: "page-actions-menu",
    title: "Menu “⋯”: di chuyển, độ rộng xem, xuất & xoá",
    category: "Workspace",
    description:
      "Mọi thao tác trên trang ngoài việc chỉnh sửa văn bản đều nằm sau nút ⋯ cạnh tiêu đề trang.",
    keywords: [
      "move page",
      "di chuyển trang",
      "full width",
      "delete page",
      "xoá trang",
      "page tree",
      "reorganize",
      "more actions",
    ],
    body: (
      <>
        <p>
          Nhấn biểu tượng <Code>⋯</Code> (<strong>More page actions</strong>) cạnh{" "}
          <strong>Edit</strong> để thấy mọi thứ không phải chỉnh sửa trực tiếp:
        </p>

        <Screenshot
          src="/help/page-actions-menu.png"
          alt="Menu More page actions đang mở, liệt kê Move page, Page history, Labels, Attachments, View, Export, và Delete page"
          caption="Move page, Page history, Labels, Attachments, View, Export, Delete page."
        />

        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Move page</strong>: chọn một <strong>Space</strong> đích và một{" "}
            <strong>Parent page</strong> (có thể tìm kiếm, hoặc{" "}
            <Code>Top-level page</Code>) để chuyển một trang đến bất kỳ đâu - kể
            cả sang một space khác. Các trang con di chuyển theo, và bộ chọn sẽ
            không cho bạn thả một trang vào bên trong một trang con cháu của chính
            nó.
          </li>
          <li>
            <strong>Page history</strong>: mở dòng thời gian các phiên bản (xem{" "}
            <em>Lịch sử phiên bản, So sánh trực quan & Xuất tệp</em>).
          </li>
          <li>
            <strong>Import from file…</strong>: chuyển tài liệu thành các trang
            con mới (xem <em>Nhập tài liệu thành trang mới</em> trong Attachments
            &amp; Media).
          </li>
          <li>
            <strong>View</strong> → <strong>Full width</strong> /{" "}
            <strong>Normal width</strong>: mở rộng cột đọc, hữu ích cho các trang
            dày đặc bảng biểu hoặc ảnh chụp màn hình.
          </li>
          <li>
            <strong>Export</strong> → <strong>HTML</strong> / <strong>PDF</strong>{" "}
            / <strong>Word</strong>: xem <em>Lịch sử phiên bản, So sánh trực quan &
            Xuất tệp</em> để biết chính xác mỗi định dạng giữ lại những gì.
          </li>
          <li>
            <strong className="text-danger">Delete page</strong>: xoá vĩnh viễn
            trang này.
          </li>
        </ul>

        <Callout variant="warning" title="XOÁ KHÔNG BAO GIỜ LÀM MỒ CÔI TRANG CON">
          Xoá một trang sẽ đưa các trang con của nó lên một cấp thay vì xoá luôn
          chúng - nội dung của các trang con luôn được giữ và có thể truy cập.
        </Callout>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // WRITING CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "pages",
    title: "Trang, Thanh công cụ dính & Chỉnh sửa mã nguồn",
    category: "Writing",
    description:
      "Làm chủ trình soạn thảo rich-text, thanh công cụ dính (sticky toolbar), trình sửa mã nguồn, và bản nháp.",
    keywords: [
      "editor",
      "trình soạn thảo",
      "toolbar",
      "sticky",
      "markdown",
      "html",
      "source",
      "mã nguồn",
      "draft",
      "bản nháp",
      "autosave",
      "rename",
      "rename page",
      "title",
      "đổi tên",
    ],
    body: (
      <>
        <p>
          WikiHub có một trình soạn thảo tài liệu hiện đại, được thiết kế để viết
          nhanh và không xao nhãng.
        </p>

        <Screenshot
          src="/help/page-view.png"
          alt="Một trang có tiêu đề, danh sách gạch đầu dòng, bảng, và khối code có tô màu cú pháp, cùng sidebar cây trang bên trái"
          caption="Một trang khi đã có nội dung thực - tiêu đề, danh sách, bảng, và khối code."
        />

        <Callout variant="important" title="THANH CÔNG CỤ CUỘN DÍNH">
          Khi bạn cuộn xuống các tài liệu dài ở chế độ chỉnh sửa, thanh công cụ
          của trình soạn thảo vẫn cố định ở đầu màn hình. Bạn có thể định dạng
          văn bản, chèn phần tử, hoặc chuyển chế độ bất cứ lúc nào mà không cần
          cuộn lên lại.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">Chế độ chỉnh sửa & Công cụ:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Đổi tên một trang</strong>: nhấn <strong>Edit</strong>, sau đó
            nhấn vào chính tiêu đề ở đầu trang - nó trở nên chỉnh sửa được ngay
            tại đó, không cần hộp thoại riêng. Trang giữ nguyên liên kết hiện có
            khi bạn lưu, nên bất cứ gì đã trỏ đến nó vẫn hoạt động.
          </li>
          <li>
            <strong>Chế độ Rich-Text</strong>: chỉnh sửa WYSIWYG với đầy đủ công cụ
            định dạng nội tuyến:
            <div className="mt-1 flex flex-wrap gap-1">
              <Kbd>Bold (Ctrl+B)</Kbd>
              <Kbd>Italic (Ctrl+I)</Kbd>
              <Kbd>Underline (Ctrl+U)</Kbd>
              <Kbd>Strikethrough</Kbd>
              <Kbd>Inline Code</Kbd>
              <Kbd>Link (Ctrl+K)</Kbd>
            </div>
          </li>
          <li>
            <strong>Chế độ Mã nguồn Markdown & HTML</strong>: Nhấn{" "}
            <Code>&lt;Source /&gt;</Code> trong tiêu đề trình soạn thảo để chuyển
            sang xem mã Markdown hoặc HTML thô. Rất phù hợp để dán tài liệu kỹ
            thuật, kiểm tra markup, hoặc tinh chỉnh chính xác các phần tử HTML.
          </li>
          <li>
            <strong>Bản nháp tự động (cục bộ & server)</strong>: Mỗi lần gõ phím
            đều tự động được lưu vào bộ nhớ cục bộ của trình duyệt và đồng bộ với
            server. Nếu bạn vô tình đóng trình duyệt, bản nháp của bạn được khôi
            phục liền mạch khi quay lại.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "slash-commands",
    title: "Tra cứu nhanh Slash Commands (/)",
    category: "Writing",
    description:
      "Danh sách tương tác đầy đủ các lệnh / để chèn khối nội dung tức thì.",
    keywords: [
      "slash",
      "shortcut",
      "phím tắt",
      "heading",
      "tiêu đề",
      "callout",
      "table",
      "bảng",
      "code",
      "image",
      "hình ảnh",
      "todo",
      "toggle",
    ],
    body: (
      <>
        <p>
          Gõ <Code>/</Code> ở đầu một đoạn văn trống để mở{" "}
          <strong>Slash Command Popup Menu</strong>. Tiếp tục gõ để lọc lệnh, hoặc
          nhấn <Kbd>Enter</Kbd> để chèn.
        </p>

        <div className="border-border bg-surface mt-4 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-32">Lệnh</th>
                <th className="p-2.5 w-40">Tên</th>
                <th className="p-2.5">Mô tả & Hành vi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/h1</Code>, <Code>/h2</Code>, <Code>/h3</Code></td>
                <td className="p-2.5 font-medium">Tiêu đề</td>
                <td className="p-2.5">Chèn Tiêu đề mục 1, 2, hoặc 3.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/bullet</Code></td>
                <td className="p-2.5 font-medium">Danh sách gạch đầu dòng</td>
                <td className="p-2.5">Tạo một mục danh sách không có thứ tự.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/numbered</Code></td>
                <td className="p-2.5 font-medium">Danh sách đánh số</td>
                <td className="p-2.5">Tạo một mục danh sách có thứ tự tuần tự.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/todo</Code></td>
                <td className="p-2.5 font-medium">Danh sách To-Do</td>
                <td className="p-2.5">Mục checkbox tương tác; trạng thái được giữ lại khi lưu.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/quote</Code></td>
                <td className="p-2.5 font-medium">Trích dẫn (Blockquote)</td>
                <td className="p-2.5">Khối trích dẫn có viền nhấn.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/callout</Code></td>
                <td className="p-2.5 font-medium">Callout cảnh báo</td>
                <td className="p-2.5">Khối cảnh báo nổi bật kèm biểu tượng.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/toggle</Code></td>
                <td className="p-2.5 font-medium">Toggle thu gọn</td>
                <td className="p-2.5">Khối accordion có thể mở rộng/thu gọn.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/table</Code></td>
                <td className="p-2.5 font-medium">Bảng dữ liệu</td>
                <td className="p-2.5">Chèn một ma trận bảng dữ liệu nhiều cột.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/code</Code></td>
                <td className="p-2.5 font-medium">Khối code</td>
                <td className="p-2.5">Khối code tô màu cú pháp kèm bộ chọn ngôn ngữ.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/image</Code></td>
                <td className="p-2.5 font-medium">Tải ảnh lên</td>
                <td className="p-2.5">Tải ảnh lên với tay cầm chỉnh cỡ ở góc & chú thích.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/attachment</Code></td>
                <td className="p-2.5 font-medium">Tệp đính kèm</td>
                <td className="p-2.5">Tải tệp lên với modal chi tiết & xem trước code.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/divider</Code></td>
                <td className="p-2.5 font-medium">Đường phân cách</td>
                <td className="p-2.5">Đường kẻ ngang phân cách (<Code>---</Code>).</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/link-to-page</Code></td>
                <td className="p-2.5 font-medium">Liên kết chọn trang</td>
                <td className="p-2.5">Tìm và chèn một liên kết nội tuyến đến trang wiki khác.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/subpage</Code></td>
                <td className="p-2.5 font-medium">Tạo trang con</td>
                <td className="p-2.5">Tạo một trang con mới bên dưới trang hiện tại, không cần rời trình soạn thảo.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "images-and-attachments",
    title: "Hình ảnh, Chỉnh cỡ & Tệp đính kèm",
    category: "Writing",
    description:
      "Tải ảnh lên, kéo tay cầm chỉnh cỡ, canh lề, thêm chú thích, và xem trước tệp.",
    keywords: ["image", "hình ảnh", "attachment", "tệp đính kèm", "resize", "chỉnh cỡ", "align", "canh lề", "caption", "chú thích", "preview", "xem trước", "modal", "zoom", "lightbox", "expand"],
    body: (
      <>
        <p>
          WikiHub giúp việc tích hợp media trở nên liền mạch cho tài liệu kỹ
          thuật.
        </p>

        <Callout variant="tip" title="TẢI LÊN BẰNG KÉO-THẢ">
          Bạn có thể kéo ảnh trực tiếp từ máy tính vào bề mặt trình soạn thảo để
          tải lên ngay lập tức.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">Tính năng hình ảnh:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Tay cầm chỉnh cỡ ở góc</strong>: Nhấn vào một ảnh ở chế độ
            chỉnh sửa để hiện các tay cầm ở góc. Nhấn và kéo tay cầm để thay đổi độ
            rộng theo pixel một cách linh hoạt.
          </li>
          <li>
            <strong>Thanh công cụ ảnh nổi</strong>: Di chuột qua bất kỳ ảnh nào để
            truy cập các điều khiển vị trí nhanh: <Code>Align Left</Code>,{" "}
            <Code>Center</Code>, <Code>Align Right</Code>, và{" "}
            <Code>Edit Caption</Code>.
          </li>
          <li>
            <strong>Chú thích</strong>: Thêm chú thích mô tả bên dưới ảnh; chú
            thích được định dạng bằng văn bản nhẹ để trình bày gọn gàng.
          </li>
          <li>
            <strong>Nhấn để phóng to</strong>: Trên một trang đã xuất bản (không
            phải khi đang chỉnh sửa), nhấn vào bất kỳ ảnh nào để mở toàn màn hình.
            Cuộn hoặc nhấn đúp để phóng to/thu nhỏ, kéo để di chuyển khi đã phóng
            to, và dùng nút <Code>+</Code>/<Code>-</Code> trên thanh công cụ hoặc
            biểu tượng đặt lại để điều khiển chính xác. Nhấn bên ngoài ảnh, nhấn{" "}
            <Code>Esc</Code>, hoặc dùng nút <Code>X</Code> để đóng.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">Tệp đính kèm:</p>
        <p className="text-sm">
          Tải lên tài liệu PDF, kho nén (<Code>.zip</Code>, <Code>.tar.gz</Code>),
          tệp code, video, hoặc tài liệu Office theo cách tương tự. Nhấn vào bất
          kỳ tệp đính kèm nào sẽ mở cùng một modal xem trước tương tác - xem hướng
          dẫn <strong>Attachments &amp; Media</strong> để biết mỗi loại tệp có thể
          làm gì sau khi tải lên, bao gồm chỉnh sửa Office tại chỗ, trình chiếu
          PowerPoint, và Picture-in-Picture cho video.
        </p>
      </>
    ),
  },
  {
    id: "tables-and-codeblocks",
    title: "Bảng, Khối code & Các thành phần tương tác",
    category: "Writing",
    description:
      "Quản lý bảng nhiều cột, tô màu cú pháp, sao chép 1-chạm, và tác vụ có thể đánh dấu.",
    keywords: [
      "table",
      "bảng",
      "codeblock",
      "syntax",
      "toggle",
      "collapsible",
      "todo",
      "copy",
      "sao chép",
    ],
    body: (
      <>
        <p>Trình bày thông tin có cấu trúc bằng các khối tương tác nâng cao.</p>

        <p className="mt-3 font-semibold text-foreground">1. Bảng dữ liệu:</p>
        <Screenshot
          src="/help/table-crop.png"
          alt="Một bảng đã hiển thị với dòng tiêu đề và bốn dòng dữ liệu"
          caption="Một bảng, được hiển thị trong một trang."
        />
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Di chuột qua các ô của bảng để hiện các mũi tên thao tác chèn/xoá dòng
            và cột.
          </li>
          <li>Bật/tắt định dạng dòng tiêu đề để làm nổi bật tên cột.</li>
          <li>Các ô hỗ trợ định dạng nội tuyến phong phú (liên kết, in đậm, code nội tuyến).</li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Khối code có tô màu cú pháp:
        </p>
        <Screenshot
          src="/help/codeblock-crop.png"
          alt="Một khối code TypeScript được tô màu cú pháp kèm nhãn ngôn ngữ"
          caption="Một khối code, được tô màu cú pháp theo ngôn ngữ."
        />
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Tự động tô màu cú pháp bởi Prism/HLJS cho hơn 40 ngôn ngữ (Python,
            TypeScript, Go, Rust, SQL, Bash, Dockerfile, v.v.).
          </li>
          <li>
            <strong>Thanh tuỳ chọn</strong>: Nhấn biểu tượng tuỳ chọn ở góc trên
            bên phải của bất kỳ khối code nào để mở{" "}
            <strong>Code Block Details Modal</strong> để đặt ngôn ngữ, tiêu đề,
            hoặc số dòng.
          </li>
          <li>
            <strong>Sao chép 1-chạm</strong>: Người đọc có thể nhấn nút{" "}
            <Code>Copy</Code> để sao chép mã nguồn thô vào clipboard ngay lập tức.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          3. Toggle thu gọn & Danh sách To-Do:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <strong>Khối Toggle</strong>: Thu gọn nội dung phụ dài (như changelog
            hoặc payload thô) dưới một chevron có thể mở rộng.
          </li>
          <li>
            <strong>Danh sách To-Do có thể đánh dấu</strong>: Tạo danh sách công
            việc. Nhấn vào checkbox sẽ chuyển đổi trạng thái hoàn thành và được
            giữ lại khi lưu.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "history-and-export",
    title: "Lịch sử phiên bản, So sánh trực quan & Xuất tệp",
    category: "Writing",
    description:
      "So sánh các phiên bản tài liệu, khôi phục phiên bản cũ an toàn, và xuất sang PDF, HTML, hoặc Word.",
    keywords: [
      "revision",
      "phiên bản",
      "history",
      "lịch sử",
      "compare",
      "so sánh",
      "diff",
      "restore",
      "khôi phục",
      "pdf",
      "html",
      "word",
      "docx",
      "export",
      "xuất",
    ],
    body: (
      <>
        <p>
          WikiHub giữ lại một nhật ký kiểm toán đầy đủ, không thể thay đổi, cho
          mỗi thay đổi được lưu vào một trang.
        </p>

        <Screenshot
          src="/help/history-timeline.png"
          alt="Bảng Revision History: danh sách các phiên bản bên trái, và bản so sánh song song hai phiên bản bên phải với phần thêm mới được tô sáng"
          caption="Revision History - danh sách phiên bản, và bản so sánh song song của hai phiên bản bất kỳ."
        />

        <Callout variant="tip" title="AN TOÀN KHI KHÔI PHỤC PHIÊN BẢN">
          Khôi phục một phiên bản cũ không bao giờ xoá lịch sử! Việc khôi phục tạo
          ra một phiên bản mới hoàn toàn với nội dung cũ, nên mọi phiên bản trung
          gian vẫn được giữ nguyên vẹn mãi mãi.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">Tính năng lịch sử:</p>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            <strong>Dòng thời gian lịch sử trang</strong>: Nhấn{" "}
            <strong>History</strong> trên thanh hành động của trang để xem danh
            sách theo thời gian các phiên bản kèm tác giả, thời gian, và tóm tắt
            thay đổi.
          </li>
          <li>
            <strong>So sánh trực quan</strong>: Chọn hai phiên bản bất kỳ để so
            sánh thay đổi song song hoặc theo dòng. Phần thêm mới được tô sáng
            màu xanh, phần bị xoá được tô sáng màu đỏ.
          </li>
          <li>
            <strong>Xuất tệp</strong>: Mở <strong>Export</strong> trong các hành
            động của trang để tải trang về dạng PDF, HTML, hoặc Word. PDF và HTML
            được render từ đúng trang bạn thấy trên màn hình, nên màu sắc, font
            chữ, tô màu cú pháp code, callout, và bảng biểu ra kết quả giống hệt
            trang thực - không phải một bản xấp xỉ được định dạng lại.
          </li>
        </ol>

        <Callout variant="note" title="ĐIỀU GÌ TRÔNG KHÁC ĐI KHI XUẤT TỆP">
          Một mục toggle đang thu gọn sẽ xuất ra ở trạng thái mở rộng hoàn toàn,
          vì một tệp tĩnh không có cách nào để nhấn mở nó. Word là định dạng duy
          nhất có giới hạn thực sự: định dạng .docx của nó không có gì tương đương
          với góc bo tròn CSS, đổ bóng, hay gradient, nên một callout hay khối
          code sẽ ra thành một đoạn văn bản vuông có tô nền - trung thực về màu
          sắc và nội dung, nhưng không đúng hình dạng. PDF và HTML không có giới
          hạn này.
        </Callout>
      </>
    ),
  },
  {
    id: "drafts-and-autosave",
    title: "Tự động lưu & Khôi phục bản nháp",
    category: "Writing",
    description:
      "Mỗi lần chỉnh sửa được bảo vệ bởi một bản nháp đồng bộ với server, kèm một banner khôi phục nếu bạn chưa thực sự xuất bản nó.",
    keywords: [
      "draft",
      "bản nháp",
      "autosave",
      "auto-save",
      "recovery",
      "khôi phục",
      "discard",
      "unsaved",
      "conflict",
      "xung đột",
    ],
    body: (
      <>
        <p>
          Xuất bản một trang (nhấn <Code>Save</Code>) và chỉ đơn thuần có thay đổi
          chưa lưu là hai việc khác nhau trong WikiHub - một hệ thống bản nháp
          riêng nằm giữa hai việc đó, để một tab bị đóng hay trình duyệt bị treo
          không bao giờ khiến bạn mất công sức thực sự.
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Bật/tắt tự động lưu</strong>: khi đang chỉnh sửa, bật{" "}
            <Code>Auto-save</Code> (trong thanh công cụ trình soạn thảo) để lưu
            bản chỉnh sửa đang dở lên server mỗi 30 giây - tách biệt với việc thực
            sự xuất bản trang. Một bản sao cục bộ cũng được giữ trong trình duyệt
            của bạn như một phương án dự phòng.
          </li>
          <li>
            <strong>Khôi phục một bản nháp</strong>: nếu bạn rời trang (hoặc trình
            duyệt đóng) trong khi còn một bản nháp chưa xuất bản, quay lại trang
            đó sẽ hiện một banner <Code>Draft not released</Code> - &ldquo;This
            draft was last saved on {"{date}"} and has not been saved to the
            page.&rdquo; Nhấn <strong>Open editor</strong> để tiếp tục đúng chỗ
            bạn đã dừng lại, hoặc <strong>Discard draft</strong> để bỏ nó đi.
          </li>
          <li>
            <strong>Cảnh báo xung đột</strong>: nếu ai đó khác đã xuất bản thay
            đổi cho trang sau khi bản nháp của bạn được tạo, banner sẽ thêm{" "}
            <em>&ldquo;The page has changed since this draft was created.&rdquo;</em>{" "}
            để bạn biết cần kiểm tra chồng chéo trước khi tiếp tục.
          </li>
        </ul>

        <Callout variant="tip" title="BỎ BẢN NHÁP LÀ AN TOÀN, KHÔNG ÂM THẦM">
          <strong>Discard draft</strong> sẽ hỏi &ldquo;Discard unreleased
          draft?&rdquo; trước khi làm bất cứ điều gì - nó chỉ xoá bản nháp đã lưu
          và khôi phục trang về nội dung hiện tại, đã xuất bản.
        </Callout>
      </>
    ),
  },
  {
    id: "format-conversion",
    title: "Chuyển đổi giữa Rich Text, Markdown & HTML",
    category: "Writing",
    description:
      "Chuyển đổi định dạng gốc của một trang ngay tức thì, kèm cảnh báo rõ ràng về những gì một phép chuyển đổi mất mát sẽ thay đổi.",
    keywords: [
      "markdown",
      "html",
      "convert",
      "chuyển đổi",
      "live preview",
      "split",
      "source",
      "lossy",
    ],
    body: (
      <>
        <p>
          Chuyển chế độ chỉnh sửa của một trang giữa <strong>Rich text</strong> và
          mã nguồn <strong>Markdown</strong> không chỉ là một cách xem khác của
          cùng dữ liệu - định dạng nội dung gốc thực sự thay đổi, nên WikiHub sẽ
          xác nhận trước.
        </p>

        <Callout variant="warning" title="CHUYỂN SANG MARKDOWN CÓ THỂ MẤT MÁT ĐỊNH DẠNG">
          Markdown không thể biểu diễn mọi tính năng rich-text - màu chữ, màu nền
          ô, và các ô bảng đã gộp không có cú pháp Markdown tương ứng. Để vẫn giữ
          lại chúng, WikiHub nhúng trực tiếp HTML thô của chúng vào bên trong mã
          nguồn Markdown thay vì âm thầm bỏ đi. Chuyển ngược lại HTML luôn không
          mất mát.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">
          Khi đang chỉnh sửa ở chế độ mã nguồn Markdown:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Xem trước trực tiếp</strong>: bật/tắt bản xem trước đã hiển
            thị của Markdown cùng với mã nguồn thô.
          </li>
          <li>
            <strong>Bố cục Split / Full</strong>: chọn xem song song mã
            nguồn-và-xem trước, hoặc chỉ xem trước để rà soát trước khi lưu.
          </li>
        </ul>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ATTACHMENTS & MEDIA CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "attachment-previews",
    title: "Xem trước tệp mà không rời trang",
    category: "Attachments & Media",
    description:
      "Mở bất kỳ tệp đã tải lên nào - ảnh, PDF, video, code, hoặc tài liệu Office - trong một modal xem trước trực tiếp, không cần tải về.",
    keywords: [
      "attachment",
      "tệp đính kèm",
      "preview",
      "xem trước",
      "modal",
      "pdf",
      "zoom",
      "rotate",
      "xoay",
      "download",
      "tải về",
      "code",
      "search",
      "tìm kiếm",
    ],
    body: (
      <>
        <p>
          Nhấn vào bất kỳ tệp đính kèm nào trong một trang để mở modal{" "}
          <strong>Attachment details</strong> - cùng một modal cho mọi loại tệp,
          với một khung xem trước thích ứng theo loại tệp thực tế:
        </p>

        <Screenshot
          src="/help/attachment-preview.png"
          alt="Modal Attachment details, hiển thị bản xem trước ảnh và nút Download"
          caption="Attachment details - khung xem trước ở trên, Download luôn sẵn có."
        />

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Ảnh</strong>: phóng to và di chuyển (pan).
          </li>
          <li>
            <strong>PDF</strong>: trình xem nhiều trang liên tục với zoom out /
            actual size / zoom in, nút <strong>Rotate pages</strong> (xoay từng
            90°), và một nút chuyển sang kích thước đầy đủ.
          </li>
          <li>
            <strong>Video</strong>: đầy đủ điều khiển phát cộng phụ đề, chuyển đổi
            track âm thanh, và Picture-in-Picture - xem{" "}
            <em>Video: Phụ đề, Track âm thanh & Picture-in-Picture</em> bên dưới.
          </li>
          <li>
            <strong>Word, Excel &amp; PowerPoint</strong>: một bản xem trước được
            render trung thực (với các điều khiển zoom riêng) và, khi bạn đang
            chỉnh sửa trang, một nút <strong>Edit</strong> - xem{" "}
            <em>Chỉnh sửa Word, Excel & PowerPoint tại chỗ</em> bên dưới.
          </li>
          <li>
            <strong>Tệp code & văn bản</strong> (<Code>.py</Code>, <Code>.ts</Code>
            , <Code>.json</Code>, <Code>.md</Code>, <Code>.log</Code>, v.v.): tô
            màu cú pháp kèm số dòng, một ô <strong>Search content…</strong> có bộ
            đếm số khớp và điều hướng khớp trước/sau (<Kbd>Enter</Kbd> /{" "}
            <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> để xoay vòng các kết quả), và một
            nút bật/tắt word-wrap.
          </li>
          <li>
            <strong>Mọi loại khác</strong> (kho nén, tệp nhị phân, loại không
            nhận diện được): thông tin tệp và một nút <strong>Download</strong>.
          </li>
        </ul>

        <Callout variant="tip" title="THÔNG TIN TỆP TRONG NHÁY MẮT">
          Di chuột vào biểu tượng <Code>ⓘ</Code> cạnh tiêu đề &ldquo;Attachment
          details&rdquo; để xem tên tệp, kích thước, loại MIME, và ngày tải lên -
          mà không cần mở Download.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: kiểm tra nội dung chính xác của tệp{" "}
          <Code>config.json</Code> của đồng nghiệp, xem lại một hợp đồng PDF đã ký,
          hoặc lướt qua một ảnh thiết kế PNG - tất cả mà không bao giờ rời khỏi
          trang wiki mà nó được đính kèm.
        </p>
      </>
    ),
  },
  {
    id: "office-editing",
    title: "Chỉnh sửa Word, Excel & PowerPoint tại chỗ",
    category: "Attachments & Media",
    description:
      "Mở trình soạn thảo tài liệu tích hợp sẵn ngay từ bản xem trước tệp đính kèm - không cần tải về, sửa, rồi tải lên lại.",
    keywords: [
      "onlyoffice",
      "word",
      "excel",
      "powerpoint",
      "docx",
      "xlsx",
      "pptx",
      "edit",
      "chỉnh sửa",
      "autosave",
    ],
    body: (
      <>
        <p>
          WikiHub có thể nhúng một trình soạn thảo tài liệu <strong>ONLYOFFICE</strong>{" "}
          đầy đủ ngay bên trong modal xem trước tệp đính kèm cho các tệp{" "}
          <Code>.docx</Code>, <Code>.xlsx</Code>, và <Code>.pptx</Code> - cùng
          ribbon, công thức, định dạng, và bố cục slide như ứng dụng desktop, chạy
          ngay trong trình duyệt.
        </p>

        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            Trong khi <strong>đang chỉnh sửa</strong> trang (nút Edit chỉ xuất
            hiện ở chế độ chỉnh sửa, không phải với người chỉ đang đọc trang), mở
            tệp đính kèm và nhấn <strong>Edit</strong> (biểu tượng bút chì) cạnh
            Download.
          </li>
          <li>
            Thay đổi <strong>tự động lưu</strong> khi bạn gõ - không có nút Save
            thủ công, và thanh công cụ hiển thị <Code>Saving changes…</Code> hoặc{" "}
            <Code>{"{filename}"} · Changes save automatically</Code>. Mỗi lần lưu
            tăng phiên bản của tệp đính kèm, nên nó luôn được tính vào hoạt động
            của trang.
          </li>
          <li>
            Nhấn <strong>Back to preview</strong> để quay lại bản xem chỉ đọc bất
            cứ lúc nào.
          </li>
        </ol>

        <Callout variant="note" title="CHỈ .DOCX / .XLSX / .PPTX MỚI CHỈNH SỬA ĐƯỢC">
          Các định dạng Office khác - <Code>.doc</Code>, <Code>.ppt</Code>,{" "}
          <Code>.xls</Code>, <Code>.odp</Code>, <Code>.ods</Code>, và các biến thể
          template như <Code>.dotx</Code>/<Code>.potx</Code>/<Code>.xltx</Code> -
          xem trước đúng nhưng phải chỉnh sửa ở nơi khác rồi tải lên lại.
        </Callout>

        <Callout variant="warning" title="CẦN CÓ DOCUMENT SERVER ĐÃ ĐƯỢC ADMIN KẾT NỐI">
          Nút Edit chỉ xuất hiện khi một quản trị viên đã cấu hình và kết nối một
          ONLYOFFICE Document Server. Nếu nó hoàn toàn không có, hoặc hiện
          &ldquo;The workspace document editor is not configured,&rdquo; hãy hỏi
          quản trị viên của bạn.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: sửa một lỗi chính tả trong tệp đặc tả kỹ thuật{" "}
          <Code>.docx</Code> dùng chung, hoặc cập nhật một tệp ngân sách{" "}
          <Code>.xlsx</Code> mà không cần rời wiki hay gửi qua lại một bản sao
          mới qua email.
        </p>
      </>
    ),
  },
  {
    id: "video-playback",
    title: "Video: Phụ đề, Track âm thanh & Picture-in-Picture",
    category: "Attachments & Media",
    description:
      "Phát video đã tải lên với khả năng chuyển đổi phụ đề và track âm thanh, và tiếp tục xem trong một cửa sổ nổi trong khi bạn làm việc ở nơi khác.",
    keywords: [
      "video",
      "subtitle",
      "phụ đề",
      "caption",
      "audio track",
      "track âm thanh",
      "picture-in-picture",
      "pip",
      "mp4",
    ],
    body: (
      <>
        <p>
          Nhấn vào một tệp video đính kèm để mở trình phát HTML5 chuẩn với
          play/pause, tua, âm lượng, và toàn màn hình.
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Phụ đề</strong>: nếu video có track phụ đề, một nút{" "}
            <strong>Subtitles</strong> xuất hiện trên thanh công cụ xem trước -
            chọn một track, hoặc <Code>Off</Code>.
          </li>
          <li>
            <strong>Track âm thanh</strong>: với video có nhiều hơn một track âm
            thanh, một bộ chọn <strong>Audio track</strong> cho phép chuyển đổi
            giữa chúng (chỉ khi chính trình duyệt hiển thị nhiều track - không
            phải mọi định dạng đều hỗ trợ điều này).
          </li>
          <li>
            <strong>Picture-in-Picture</strong>: dùng biểu tượng PiP trong các
            điều khiển của trình phát (hoặc nhấn chuột phải → <em>Picture in
            Picture</em>) để đưa video vào một cửa sổ nổi nhỏ luôn nằm trên mọi
            cửa sổ và tab khác.
          </li>
        </ul>

        <Callout variant="tip" title="PIP TIẾP TỤC PHÁT KHI MODAL BỊ ĐÓNG">
          Đóng bản xem trước tệp đính kèm trong khi video đang nổi ở chế độ
          Picture-in-Picture sẽ <strong>không</strong> dừng nó lại - giống hệt
          việc đóng một tab trình duyệt không dừng một video PiP ở nơi khác trên
          web. Rời khỏi PiP (nút &ldquo;back to tab&rdquo; hoặc đóng của chính
          nó) sẽ tự động mở lại bản xem trước, tiếp tục đúng chỗ bạn đã dừng. Chỉ
          đóng bản xem trước vừa mở lại đó mới thực sự dừng phát.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: xem một bản demo hoặc video đào tạo đã ghi ở góc màn
          hình trong khi bạn ghi chú hoặc trả lời chat ở một tab khác.
        </p>
      </>
    ),
  },
  {
    id: "pptx-slideshow",
    title: "Trình chiếu PowerPoint: Slideshow toàn màn hình",
    category: "Attachments & Media",
    description:
      "Chạy một tệp PowerPoint đính kèm như một slideshow toàn màn hình thực sự, ngay từ bản xem trước của nó.",
    keywords: [
      "powerpoint",
      "pptx",
      "slideshow",
      "trình chiếu",
      "present",
      "presentation",
      "fullscreen",
      "toàn màn hình",
    ],
    body: (
      <>
        <p>
          Mở bất kỳ tệp <Code>.pptx</Code> nào - nó hiển thị như một tập slide
          phân trang với dải thumbnail bên trái và slide hiện tại bên phải. Dùng
          mũi tên <Code>‹ ›</Code> trên màn hình, hoặc <Kbd>←</Kbd>/<Kbd>→</Kbd>,
          để chuyển giữa các slide bất cứ lúc nào.
        </p>

        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            Nhấn <strong>Present</strong> (biểu tượng màn hình nhỏ trên thanh công
            cụ) để bắt đầu một slideshow toàn màn hình: tập slide lấp đầy toàn bộ
            màn hình, có viền đen theo đúng tỷ lệ khung hình của slide, không có
            giao diện trình duyệt hay dải thumbnail nào cản trở.
          </li>
          <li>
            Nhấn <Kbd>Esc</Kbd>, hoặc nhấn <Code>✕</Code> ở góc trên bên phải, để
            thoát - quay về bản xem trước bình thường, không phải toàn bộ cửa sổ
            tệp đính kèm.
          </li>
        </ol>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: trình chiếu một bộ slide ngay từ trang wiki mà nó
          được đính kèm trong một cuộc họp, không cần phần mềm phụ và không cần
          tải tệp về trước.
        </p>
      </>
    ),
  },
  {
    id: "importing-documents",
    title: "Nhập tài liệu thành trang mới",
    category: "Attachments & Media",
    description:
      "Biến các tài liệu Word, PDF, Markdown, và các loại khác đã có thành trang wiki hàng loạt - không cần copy-paste.",
    keywords: [
      "import",
      "nhập",
      "docx",
      "pdf",
      "markdown",
      "epub",
      "convert",
      "chuyển đổi",
      "bulk",
      "hàng loạt",
      "drag and drop",
      "kéo thả",
    ],
    body: (
      <>
        <p>
          Từ bất kỳ trang nào, mở menu <Code>⋯</Code> và chọn{" "}
          <strong>Import from file…</strong>.
        </p>

        <Screenshot
          src="/help/import-dialog.png"
          alt="Hộp thoại Import pages from files, với vùng thả tệp ghi 'Drop Word, PDF, HTML or Markdown files here' và nút Choose files"
          caption="Import pages from files - kéo thả, hoặc duyệt tệp, tối đa 20 tệp mỗi lần."
        />

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            Kéo thả, hoặc duyệt tìm, tối đa <strong>20 tệp</strong> mỗi lần. Định
            dạng được hỗ trợ: Word (<Code>.docx</Code>), OpenDocument Text (
            <Code>.odt</Code>), Rich Text (<Code>.rtf</Code>), EPUB (
            <Code>.epub</Code>), HTML (<Code>.html</Code>/<Code>.htm</Code>),
            Markdown (<Code>.md</Code>/<Code>.markdown</Code>), và PDF (
            <Code>.pdf</Code>).
          </li>
          <li>
            Mỗi tệp trở thành một <strong>trang con</strong> mới bên dưới trang
            bạn bắt đầu (hoặc ở cấp cao nhất của space, nếu bắt đầu từ Home) -
            tiêu đề, định dạng, và hình ảnh được chuyển sang tự động.
          </li>
          <li>
            Trang mới được đặt tên theo <strong>tên tệp</strong>, bỏ phần mở rộng
            (<Code>Runbook-v2.docx</Code> trở thành trang tên{" "}
            <Code>Runbook-v2</Code>) - không theo tiêu đề hay heading bên trong
            tài liệu.
          </li>
          <li>
            Nhập chạy như một tác vụ nền với thanh tiến trình trực tiếp cho từng
            tệp (queued / running / complete / failed), mỗi tệp hoàn tất liên kết
            thẳng đến trang mới của nó, nên bạn có thể tiếp tục làm việc trong khi
            một lô lớn đang được chuyển đổi.
          </li>
        </ul>

        <Callout variant="note" title="KHÔNG GIỐNG CONFLUENCE IMPORT">
          Tính năng này khác với <strong>Confluence Archive Import</strong> trong{" "}
          <strong>Administration &gt; Backup</strong>: tính năng đó khôi phục toàn
          bộ một <em>space</em> Confluence đã xuất, bao gồm cả quyền và lịch sử,
          và chỉ dành cho admin. <strong>Import from file…</strong> chuyển đổi
          từng tài liệu riêng lẻ thành trang mới, và khả dụng cho bất kỳ ai có
          quyền chỉnh sửa space.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: di chuyển một thư mục các runbook Word hoặc PDF hiện
          có vào wiki thành một cây trang được tổ chức gọn gàng, trong một lần.
        </p>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ACCOUNT CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "your-account",
    title: "Hồ sơ, Bảo mật mật khẩu & Phiên đang hoạt động",
    category: "Account",
    description:
      "Cập nhật thông tin hồ sơ, bảo mật mật khẩu, và quản lý các phiên đang hoạt động.",
    keywords: ["avatar", "password", "mật khẩu", "authentication", "session", "phiên", "profile", "hồ sơ", "logout", "đăng xuất"],
    body: (
      <>
        <p>
          Quản lý tuỳ chọn tài khoản cá nhân của bạn trong <strong>Your
          account</strong> từ menu hồ sơ.
        </p>

        <Screenshot
          src="/help/account-profile.png"
          alt="Trang Your account: menu bên trái cho Profile, Password & authentication, Sessions, và Keyboard shortcuts, với tab Profile đang mở hiển thị tên, email, và vai trò workspace"
          caption="Your account - Profile, Password & authentication, Sessions, Keyboard shortcuts."
        />

        <p className="mt-3 font-semibold text-foreground">1. Cài đặt hồ sơ người dùng:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Nhấn <strong>Edit profile</strong> để cập nhật tên hiển thị, email,
            ảnh đại diện, tiểu sử, đại từ nhân xưng, công ty, và liên kết mạng xã
            hội.
          </li>
          <li>Kiểm tra trường dữ liệu đưa phản hồi tức thì về lỗi định dạng hay yêu cầu.</li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Bảo mật & Quy tắc mật khẩu:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Cập nhật mật khẩu của bạn trong <strong>Password &amp;
            authentication</strong>.
          </li>
          <li>
            Thanh đo độ mạnh mật khẩu kiểm tra độ dài, số, ký tự đặc biệt, và quy
            tắc chữ hoa. Nhấn <strong>Generate password</strong> để tạo một mật
            khẩu ngẫu nhiên mạnh.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">3. Quản lý phiên đang hoạt động:</p>
        <p className="text-sm">
          Trong <strong>Sessions</strong>, xem các trình duyệt đang hoạt động và
          đăng xuất mọi phiên khác nếu bạn thấy hoạt động không nhận ra. Bạn có
          thể thu hồi các thiết bị cụ thể hoặc nhấn <strong>Revoke all
          sessions</strong> để vô hiệu hoá ngay lập tức mọi token từ xa.
        </p>
      </>
    ),
  },
  {
    id: "language-switching",
    title: "Chuyển đổi ngôn ngữ giao diện",
    category: "Account",
    description:
      "Chuyển toàn bộ giao diện giữa tiếng Anh và tiếng Việt từ thanh trên cùng, áp dụng ngay lập tức.",
    keywords: [
      "language",
      "ngôn ngữ",
      "locale",
      "translation",
      "chuyển ngữ",
      "vietnamese",
      "tiếng việt",
      "english",
      "i18n",
    ],
    body: (
      <>
        <p>
          Nhấn huy hiệu <strong>EN</strong>/<strong>VI</strong> trên thanh trên
          cùng để mở menu ngôn ngữ, sau đó chọn <strong>English</strong> hoặc{" "}
          <strong>Tiếng Việt</strong>. Huy hiệu luôn hiển thị ngôn ngữ đang hoạt
          động.
        </p>

        <Screenshot
          src="/help/language-toggle.png"
          alt="Menu thả xuống ngôn ngữ đang mở trên thanh trên cùng, hiển thị English (đã chọn) và Tiếng Việt"
          caption="Thanh trên cùng - huy hiệu EN/VI mở menu ngôn ngữ."
        />

        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Mọi nhãn, nút, thông báo, và thông điệp kiểm tra dữ liệu trên khắp
            WikiHub đều theo ngôn ngữ đã chọn - không có màn hình nào chuyển ngữ
            nửa vời.
          </li>
          <li>
            Thay đổi được áp dụng ngay lập tức, không cần tải lại trang, nên bất
            cứ gì bạn đang chỉnh sửa dở trong trình soạn thảo vẫn được giữ nguyên
            như cũ.
          </li>
          <li>
            Lựa chọn được ghi nhớ theo từng trình duyệt (không gắn với tài khoản
            của bạn), nên chuyển sang máy khác hoặc đăng nhập ở nơi khác sẽ bắt
            đầu lại bằng tiếng Anh cho đến khi bạn chọn tiếng Việt ở đó nữa.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "keyboard-shortcut-settings",
    title: "Tuỳ chỉnh phím tắt bàn phím",
    category: "Account",
    description:
      "Gán lại phím tắt của WikiHub theo ý bạn, thêm tổ hợp phím thứ hai, và đặt lại về mặc định.",
    keywords: [
      "keyboard",
      "bàn phím",
      "shortcut",
      "phím tắt",
      "hotkey",
      "rebind",
      "remap",
      "gán lại",
      "customize",
      "customise",
      "tuỳ chỉnh",
      "keybinding",
      "ctrl",
      "cmd",
    ],
    body: (
      <>
        <p>
          Phím tắt của WikiHub là mặc định, không phải quy tắc cố định. Mở{" "}
          <strong>Your account</strong> từ menu hồ sơ và chọn{" "}
          <strong>Keyboard shortcuts</strong> để thay đổi bất kỳ phím nào.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Gán lại một phím tắt:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Nhấn huy hiệu phím cạnh hành động bạn muốn thay đổi - nó chuyển sang{" "}
            <em>Press keys…</em>
          </li>
          <li>
            Nhấn tổ hợp phím bạn muốn. Nó được ghi nhận và lưu ngay khi bạn nhấn;
            không có nút Save riêng.
          </li>
          <li>
            Nhấn <Kbd>Esc</Kbd> để thoát ra mà không thay đổi gì.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Nhiều phím cho một hành động:
        </p>
        <p className="text-sm">
          Nhấn <Code>+</Code> để gán cho một hành động một tổ hợp thứ hai (hoặc
          thứ ba) - hữu ích khi bạn muốn cả thói quen cũ lẫn thói quen mới đều
          hoạt động. Global search mặc định đã như vậy, đáp ứng cả{" "}
          <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> lẫn <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd>. Xoá một
          tổ hợp bằng nút <Code>✕</Code> cạnh nó; tổ hợp cuối cùng còn lại không
          thể bị xoá, nên một hành động không bao giờ vô tình trở nên không thể
          gọi được.
        </p>

        <p className="mt-4 font-semibold text-foreground">3. Quay về bình thường:</p>
        <p className="text-sm">
          Một mũi tên tròn xuất hiện cạnh bất kỳ hành động nào bạn đã thay đổi -
          nhấn vào đó để khôi phục riêng hành động đó. <strong>Reset all to
          defaults</strong> ở trên cùng khôi phục mọi phím tắt cùng lúc.
        </p>

        <p className="mt-4 font-semibold text-foreground">4. Phạm vi áp dụng của từng phím tắt:</p>
        <p className="text-sm">
          Mỗi hành động liệt kê ngữ cảnh mà nó hoạt động - bất kỳ đâu trong ứng
          dụng, khi đang chỉnh sửa một trang, hoặc khi một bản xem trước tệp đính
          kèm đang mở. Hai hành động trong <em>ngữ cảnh khác nhau</em> có thể an
          toàn dùng chung một tổ hợp, và hành động ở ngữ cảnh hẹp hơn sẽ thắng khi
          nó đang hoạt động. Đó chính xác là cách <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd>{" "}
          hoạt động theo mặc định: bình thường nó mở tìm kiếm toàn cục, nhưng khi
          bạn đang mở bản xem trước một tệp văn bản, nó sẽ tìm bên trong tệp đó
          thay vào đó.
        </p>

        <Callout variant="note" title="CẢNH BÁO XUNG ĐỘT">
          <p>
            Nếu bạn gán cùng một tổ hợp cho hai hành động trong <em>cùng</em> một
            ngữ cảnh, một cảnh báo sẽ xuất hiện ở trên cùng và cả hai huy hiệu
            chuyển sang màu hổ phách. Hành động nào xử lý phím trước sẽ thắng, nên
            hành động còn lại có thể không kích hoạt. Không có gì ngăn bạn lưu nó
            lại - cảnh báo tồn tại để một phím tắt âm thầm ngừng hoạt động không
            bao giờ trở thành một bí ẩn.
          </p>
        </Callout>

        <Callout variant="tip" title="GỢI Ý PHÍM TẮT LUÔN CẬP NHẬT">
          <p>
            Gợi ý trên thanh tìm kiếm ở thanh trên cùng luôn theo đúng những gì
            bạn đã gán, nên nó luôn hiển thị tổ hợp thực sự đang hoạt động.
          </p>
        </Callout>

        <Callout variant="warning" title="NHỮNG GÌ KHÔNG THỂ GÁN LẠI">
          <p>
            Một số tổ hợp được trình duyệt giữ riêng - <Kbd>Ctrl</Kbd>+
            <Kbd>W</Kbd>, <Kbd>Ctrl</Kbd>+<Kbd>T</Kbd>, <Kbd>Ctrl</Kbd>+
            <Kbd>N</Kbd> và tương tự. Chúng không bao giờ đến được trang, nên
            WikiHub không thể bắt được chúng.
          </p>
          <p>
            Các phím định dạng văn bản bên trong trình soạn thảo (<Kbd>Ctrl</Kbd>
            +<Kbd>B</Kbd> cho in đậm và tương tự), <Kbd>/</Kbd> cho menu slash, và{" "}
            <Kbd>Esc</Kbd> để đóng overlay cũng cố định và không xuất hiện trong
            danh sách này.
          </p>
          <p>
            Phím tắt của bạn được lưu trong trình duyệt bạn đã đặt chúng, nên
            chúng không theo bạn sang máy khác hoặc tồn tại qua việc xoá dữ liệu
            trang.
          </p>
        </Callout>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ADMINISTRATION CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "theme-and-branding",
    title: "Tuỳ chỉnh giao diện & Thương hiệu",
    category: "Administration",
    description:
      "Tuỳ chỉnh màu thương hiệu, biểu tượng logo dựng sẵn & tuỳ chỉnh, chế độ tối, và favicon động trên tab.",
    keywords: [
      "theme",
      "giao diện",
      "color",
      "màu",
      "hex",
      "palette",
      "icon",
      "logo",
      "favicon",
      "preview",
      "xem trước",
      "branding",
      "thương hiệu",
      "ssr",
    ],
    body: (
      <>
        <p>
          Quản trị viên có thể tuỳ chỉnh hoàn toàn nhận diện trực quan của
          WikiHub trong <strong>Administration &gt; Settings &gt; Theme &amp;
          Branding</strong>.
        </p>

        <Screenshot
          src="/help/theme-branding.png"
          alt="Trang cài đặt Theme & Branding: các mẫu màu thương hiệu, ô nhập hex tuỳ chỉnh, và lưới các biểu tượng logo dựng sẵn"
          caption="Theme & Branding - mẫu màu dựng sẵn, hex tuỳ chỉnh, và mẫu biểu tượng logo."
        />

        <Callout variant="important" title="CHẾ ĐỘ NHÁP & MODAL XEM TRƯỚC">
          Các thay đổi giao diện ở chế độ nháp cho đến khi bạn nhấn rõ ràng{" "}
          <strong>Save settings</strong>! Nhấn <strong>Preview Theme</strong> để
          mở một modal sandbox tương tác, nơi bạn có thể thử màu sắc, tìm kiếm,
          các tab điều hướng, nút bấm, và chế độ Sáng/Tối.
        </Callout>

        <div className="border-border bg-surface mt-4 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-44">Cài đặt</th>
                <th className="p-2.5">Mô tả & Tuỳ chọn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Mẫu màu thương hiệu</td>
                <td className="p-2.5">
                  Chọn từ 8 bảng màu được tuyển chọn: <Code>Blue</Code>,{" "}
                  <Code>Emerald</Code>, <Code>Indigo</Code>, <Code>Violet</Code>,{" "}
                  <Code>Rose</Code>, <Code>Amber</Code>, <Code>Teal</Code>,{" "}
                  <Code>Slate</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Bộ chọn Hex tuỳ chỉnh</td>
                <td className="p-2.5">
                  Nhập bất kỳ mã màu hex chính tuỳ chỉnh nào (vd: <Code>#216fc0</Code>
                  ). Tự động tạo một bảng màu HSL đầy đủ 10 sắc độ.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Mẫu biểu tượng Logo</td>
                <td className="p-2.5">
                  Chọn từ 9 biểu tượng vector dựng sẵn: <Code>Hub</Code>,{" "}
                  <Code>Book</Code>, <Code>Layers</Code>, <Code>Compass</Code>,{" "}
                  <Code>Sparkles</Code>, <Code>Feather</Code>,{" "}
                  <Code>Graduation</Code>, <Code>CPU</Code>, <Code>Shield</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Tải logo tuỳ chỉnh</td>
                <td className="p-2.5">
                  Tải lên ảnh PNG hoặc SVG tuỳ chỉnh của tổ chức bạn (dưới 2MB). Tự
                  động điều chỉnh tỷ lệ và hiển thị trên header và favicon.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Favicon động trên tab</td>
                <td className="p-2.5">
                  HTML5 Canvas chuyển các SVG dựng sẵn hoặc logo đã tải lên thành
                  PNG data URL kích thước 64x64, cập nhật ngay dải tab trình duyệt.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">SSR không nhấp nháy</td>
                <td className="p-2.5">
                  Các biến CSS theme được tải trước trong <Code>&lt;head&gt;</Code>{" "}
                  ngay từ khung hình đầu tiên, ngăn hiện tượng nhấp nháy trắng/xanh
                  khi tải lại trang.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Bộ chọn font chữ</td>
                <td className="p-2.5">
                  Nhấn vào một font trong danh sách sẽ mở modal{" "}
                  <strong>Font Specimen</strong> - một bộ kiểm tra kiểu chữ tương
                  tác với ô nhập mẫu tự do, bốn câu mẫu dựng sẵn, năm mức kích cỡ
                  dựng sẵn (14–36px), một bản mô phỏng cấu trúc tài liệu đầy đủ, và
                  một ma trận ký tự/glyph - trước khi bạn xác nhận bằng{" "}
                  <strong>Apply This Font</strong>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout variant="tip" title="XEM TRƯỚC SÁNG/TỐI MÀ KHÔNG CẦN LƯU">
          Sandbox <strong>Preview Theme</strong> có công tắc{" "}
          <strong>Light Preview</strong> / <strong>Dark Preview</strong> riêng, để
          bạn có thể kiểm tra một màu thương hiệu trên một tài liệu mẫu ở cả hai
          chế độ trước khi một người dùng thật nào thấy nó.
        </Callout>
      </>
    ),
  },
  {
    id: "settings-and-storage",
    title: "Cài đặt hệ thống & Trình duyệt Object Storage",
    category: "Administration",
    description:
      "Cấu hình tham số toàn site, giới hạn tải lên, ma trận vai trò, và object storage S3.",
    keywords: [
      "settings",
      "cài đặt",
      "storage",
      "lưu trữ",
      "objects",
      "attachment",
      "limits",
      "giới hạn",
      "matrix",
      "download",
      "s3",
      "office",
      "preview",
      "word",
      "excel",
      "powerpoint",
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "onlyoffice",
      "video",
      "audio",
      "syntax highlighting",
      "code preview",
      "quota",
      "quotas",
      "hạn mức",
      "browse files",
    ],
    body: (
      <>
        <p>
          Quản trị viên cấu hình hành vi toàn workspace trong{" "}
          <strong>Administration &gt; Settings</strong>, và mọi thứ về bucket S3
          - duyệt nó và đặt giới hạn cho nó - trong{" "}
          <strong>Administration &gt; Storage</strong>.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Cài đặt hệ thống toàn cục:</p>
        <Screenshot
          src="/help/admin-settings-general.png"
          alt="Bảng cài đặt General Workspace: các trường Site Name và Session Lifetime, mỗi trường đánh dấu kế thừa từ môi trường cho đến khi được ghi đè"
          caption="General workspace - Site Name và Session Lifetime, kế thừa cho đến khi bị ghi đè."
        />
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Site Name</strong>: Tiêu đề site tuỳ chỉnh hiển thị trên tab
            trình duyệt và thanh trên cùng.
          </li>
          <li>
            <strong>Session Lifetime (Hours)</strong>: Cấu hình thời gian hết hạn
            phiên JWT (vd: 24h, 72h, 168h).
          </li>
          <li>
            <strong>Sidebar Access Matrix</strong>: Chọn mục điều hướng nào hiển
            thị theo từng vai trò người dùng (<Code>member</Code>,{" "}
            <Code>admin</Code>).
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Storage: Duyệt tệp & Hạn mức:</p>
        <p className="text-sm">
          <strong>Administration &gt; Storage</strong> chia thành hai phần, chọn
          từ danh sách bên trái của riêng nó:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm mt-1">
          <li>
            <strong>Browse files</strong>: một trình duyệt cây bucket S3 gọn gàng.
            Lọc đối tượng theo truy vấn tìm kiếm, loại tệp, space, hoặc ID trang;
            tạo URL tải xuống ký sẵn (pre-signed) an toàn; xem trước ảnh, video và
            tệp âm thanh, tệp code/văn bản (tô màu theo phần mở rộng của tệp), và
            tài liệu Word, Excel, PowerPoint và PDF (mở ở chế độ chỉ đọc qua cùng
            trình xem tài liệu mà các trang dùng để chỉnh sửa tệp đính kèm - xem
            nó, tải nó về, không có gì được lưu lại từ đây, và mỗi bản xem trước
            cuộn ở một chỗ thay vì cả trong hộp thoại lẫn nội dung bên dưới nó); và
            xoá các đối tượng mồ côi, việc này cũng tự động xoá bản ghi tệp đính
            kèm và hash lưu trữ tương ứng trong cơ sở dữ liệu.
          </li>
          <li>
            <strong>Quotas</strong>: <strong>Max single attachment size</strong>,{" "}
            <strong>Max backup import size</strong>, và{" "}
            <strong>Allowed attachment extensions</strong> (một danh sách cho
            phép, vd: <Code>png, pdf, zip, docx, *</Code>) - mỗi mục hiển thị{" "}
            <Code>(inherited from environment)</Code> cho đến khi bạn thực sự ghi
            đè nó ở đây.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "permissions-overview",
    title: "Tra cứu Quyền & Vai trò",
    category: "Administration",
    description:
      "Toàn bộ mô hình quyền ở một chỗ: vai trò tài khoản, bốn quyền toàn cục, bảy quyền theo từng space, và cách chúng kết hợp.",
    keywords: [
      "permissions",
      "quyền",
      "roles",
      "vai trò",
      "administrator",
      "member",
      "global access",
      "global permission",
      "space permission",
      "owner",
      "open",
      "restricted",
      "system administrator",
      "effective permissions",
      "quyền hiệu lực",
      "access control",
    ],
    body: (
      <>
        <p>
          Ba lớp độc lập quyết định những gì một người có thể làm:{" "}
          <strong>Vai trò tài khoản</strong> (Member hoặc Administrator),{" "}
          <strong>Quyền toàn cục</strong> (khả năng toàn workspace như tạo space
          hoặc quản lý người dùng), và <strong>Quyền theo Space</strong> (những gì
          ai đó có thể làm bên trong một space cụ thể). Các mục bên dưới nói rõ
          từng lớp; <em>Quản lý người dùng & Nhóm</em> và{" "}
          <em>Quyền truy cập Space & Quyền hiệu lực</em> (xa hơn phía dưới) mô tả
          các màn hình thực sự thiết lập chúng.
        </p>

        <Screenshot
          src="/help/permissions-global-access.png"
          alt="Tab Global access của Edit user: tóm tắt Currently granted, sau đó bốn dòng quyền (Create spaces, Manage users, Manage groups, System administrator) mỗi dòng có huy hiệu Active/Disabled và menu thả xuống Inherit from groups"
          caption="Global access override của một tài khoản - mỗi trong bốn quyền, Active hoặc Disabled, theo từng tài khoản."
        />

        <p className="mt-4 font-semibold text-foreground">1. Vai trò tài khoản:</p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-40">Vai trò</th>
                <th className="p-2.5">Ý nghĩa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Member</Code></td>
                <td className="p-2.5">
                  Vai trò mặc định. Những gì một Member thực sự có thể làm ngoài
                  việc xem/sửa các space họ có quyền truy cập hoàn toàn đến từ các
                  quyền Global và Space bên dưới - một Member có thể giữ bất kỳ
                  quyền nào trong bốn quyền toàn cục, hoặc là Space Owner/Admin,
                  giống như bất kỳ ai khác.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Administrator</Code></td>
                <td className="p-2.5">
                  Vô điều kiện giữ cả bốn quyền toàn cục - <Code>Create
                  spaces</Code>, <Code>Manage users</Code>, <Code>Manage
                  groups</Code>, <Code>System administrator</Code> - bất kể tư
                  cách thành viên nhóm hay bất kỳ override nào. Một Administrator
                  thông thường không thể Edit, Delete, Demote, hoặc đặt lại mật
                  khẩu của một tài khoản Administrator khác, hay thay đổi Role
                  hoặc Global access override của chính mình - xem{" "}
                  <em>bảo vệ giữa các admin ngang cấp</em> bên dưới.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5">Admin khởi tạo được bảo vệ</td>
                <td className="p-2.5">
                  Tài khoản mà WikiHub được thiết lập ban đầu (hoặc một tài khoản
                  được đánh dấu bảo vệ rõ ràng). Nó luôn là Administrator, không
                  bao giờ bị chỉnh sửa, vô hiệu hoá, hay xoá bởi bất kỳ ai khác, và
                  là tài khoản <strong>duy nhất</strong> có thể Edit, Delete,
                  Demote, hoặc đặt lại mật khẩu của một Administrator khác.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-semibold text-foreground">
          2. Bốn quyền Global:
        </p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-44">Quyền</th>
                <th className="p-2.5">Mở khoá điều gì</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Create spaces</Code></td>
                <td className="p-2.5">
                  Cho phép tạo space tài liệu mới từ danh bạ{" "}
                  <strong>Spaces</strong> thông thường. Nó <strong>không</strong>{" "}
                  mở <strong>Administration &gt; Spaces</strong>, vốn vẫn chỉ dành
                  cho <Code>System administrator</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Manage users</Code></td>
                <td className="p-2.5">
                  Mở khoá <strong>Administration &gt; Users</strong>: tạo, sửa,
                  đặt lại mật khẩu, và vô hiệu hoá tài khoản <Code>Member</Code>,
                  và quản lý tư cách thành viên nhóm của họ. Nó không bao giờ
                  thăng cấp/hạ cấp ai, đụng đến một tài khoản Administrator hiện
                  có, hoặc mở tab <strong>Global access</strong> - những việc đó
                  luôn cần thực sự là một <Code>System administrator</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Manage groups</Code></td>
                <td className="p-2.5">
                  Mở khoá <strong>Administration &gt; Groups</strong>: tạo, cập
                  nhật, gán thành viên vào, và quản lý các nhóm người dùng.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>System administrator</Code></td>
                <td className="p-2.5">
                  Toàn quyền quản trị - mọi phần Administration khác (Users,
                  Groups, Spaces, Settings, Backup, Storage), cộng với mọi quyền{" "}
                  <Code>Admin</Code> theo từng space trên mọi space bất kể cài đặt
                  Owner/Access riêng của space đó. Tương đương vai trò{" "}
                  <Code>Administrator</Code> cho mọi mục đích quan trọng.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout variant="note" title="CÁCH MỘT QUYỀN GLOBAL ĐƯỢC PHÂN GIẢI">
          Mỗi trong bốn quyền được kiểm tra theo thứ tự: Role đã là{" "}
          <Code>Administrator</Code> chưa? Nếu có, được cấp ngay lập tức. Nếu
          không, một override <strong>Global access</strong> theo từng user có ép
          nó <Code>enabled</Code> hoặc <Code>disabled</Code> không? Một override
          luôn thắng. Nếu không, có nhóm nào người đó thuộc về cấp quyền này
          không? Nếu không có điều nào ở trên, nó không được cấp. Xem{" "}
          <em>Quản lý người dùng & Nhóm</em> bên dưới để biết mỗi cái này thực sự
          được đặt ở đâu.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">
          3. Bảy quyền theo từng Space:
        </p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-32">Quyền</th>
                <th className="p-2.5">Cấp quyền gì</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>View</Code></td>
                <td className="p-2.5">Xem space này và mở các trang của nó. Xuất
                  trang tự động theo <Code>View</Code> - không phải một quyền cấp
                  riêng.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Add/Edit</Code></td>
                <td className="p-2.5">Tạo trang mới và sửa bất kỳ trang hiện có
                  nào trong space này.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Delete</Code></td>
                <td className="p-2.5">Xoá bất kỳ trang nào trong space này, kể cả
                  trang do người khác tạo.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Delete own</Code></td>
                <td className="p-2.5">Chỉ xoá các trang do chính người hoặc nhóm
                  này tạo.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Restrictions</Code></td>
                <td className="p-2.5">Giới hạn từng trang riêng lẻ cho những
                  người hoặc nhóm cụ thể.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Move</Code></td>
                <td className="p-2.5">Di chuyển hoặc sắp xếp lại trang trong cây
                  phân cấp của space này.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Admin</Code></td>
                <td className="p-2.5">Toàn quyền kiểm soát cài đặt và quyền của
                  space này - bao hàm mọi quyền khác trong bảng này.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-semibold text-foreground">
          4. Space Owner, Open vs Restricted, và quyền hiệu lực:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Space Owner</strong> là một tầng riêng, được bảo vệ, nằm trên
            bảng trên - một space luôn giữ ít nhất một Owner, và chỉ một Owner
            (không chỉ đơn thuần có quyền <Code>Admin</Code>) mới có thể chuyển
            một space giữa <Code>Open</Code> và <Code>Restricted</Code>, hoặc
            thay đổi ai là Owner.
          </li>
          <li>
            <strong>Space <Code>Open</Code></strong> tự động cấp cho mọi người
            dùng đã đăng nhập <Code>View</Code>, <Code>Add/Edit</Code>,{" "}
            <Code>Delete</Code>, <Code>Delete own</Code>, và <Code>Move</Code> -
            chỉ <Code>Admin</Code> và <Code>Restrictions</Code> vẫn cần được cấp
            rõ ràng. <strong>Space <Code>Restricted</Code></strong> không tự động
            cấp gì cả - mọi quyền cho mọi người hoặc nhóm đến từ các bảng trong
            bảng <strong>Access</strong> của space đó.
          </li>
          <li>
            Với một người và một space cho trước, thứ tự phân giải là: Owner (mọi
            thứ, luôn luôn) → một quyền cấp trực tiếp theo user nếu có (điều này
            ghi đè mọi nhóm họ thuộc về cho space đó, trừ <Code>Admin</Code>) →
            nếu không, mọi nhóm họ thuộc về, kết hợp lại → nếu không, bất cứ gì{" "}
            <Code>Open</Code> tự động cấp. Bộ chọn <strong>Effective
            permissions</strong> trong bảng Access của một space phân giải tất cả
            điều này cho bạn thay vì phải đối chiếu thủ công - xem{" "}
            <em>Quyền truy cập Space & Quyền hiệu lực</em> bên dưới.
          </li>
        </ul>

        <Callout variant="important" title="BẢO VỆ GIỮA CÁC ADMIN NGANG CẤP">
          Một Administrator thông thường có thể quản lý toàn bộ mọi tài khoản{" "}
          <Code>Member</Code> - bao gồm thăng cấp một người lên Administrator -
          nhưng không thể Edit, Delete, Demote, hoặc đặt lại mật khẩu của{" "}
          <strong>một</strong> tài khoản Administrator khác. Chỉ tài khoản admin
          khởi tạo được bảo vệ mới có thể đụng đến một Administrator khác. Điều
          này giữ cho không một admin nào có thể khoá, hạ cấp, hoặc xoá mọi admin
          khác.
        </Callout>
      </>
    ),
  },
  {
    id: "admin-users-groups",
    title: "Quản lý người dùng & Nhóm",
    category: "Administration",
    description:
      "Tạo tài khoản trực tiếp (không có luồng mời qua e-mail), gán vai trò, và gộp người dùng vào các nhóm để cấp quyền tái sử dụng.",
    keywords: [
      "users",
      "người dùng",
      "groups",
      "nhóm",
      "create user",
      "tạo người dùng",
      "invite",
      "mời",
      "password",
      "mật khẩu",
      "deactivate",
      "vô hiệu hoá",
      "delete user",
      "xoá người dùng",
      "role",
      "vai trò",
      "global permission override",
      "administrators tab",
      "permission overrides",
      "permission overrides tab",
      "group directory",
      "global access tab",
      "bulk delete",
      "select multiple",
    ],
    body: (
      <>
        <Callout variant="important" title="KHÔNG CÓ LUỒNG MỜI QUA E-MAIL">
          WikiHub không gửi e-mail mời. Một quản trị viên tạo mọi tài khoản trực
          tiếp trong <strong>Administration &gt; Users &gt; Create user</strong>{" "}
          và chia sẻ mật khẩu tạm thời cho người đó ngoài hệ thống (chat, gặp
          trực tiếp, v.v.).
        </Callout>

        <Screenshot
          src="/help/admin-users-directory.png"
          alt="Danh bạ People: các ô tổng quan Total/Administrators/Members/Active/Disabled, ô tìm kiếm, và bảng tài khoản với thao tác Edit và Delete"
          caption="Danh bạ People - tìm kiếm, bộ lọc, và cặp Edit/Delete trên mỗi dòng."
        />

        <p className="mt-3 font-semibold text-foreground">1. Danh bạ People:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Danh bạ hiển thị các ô tổng quan (Total / Administrators / Members /
            Active / Disabled), cùng tìm kiếm và bộ lọc Status/Role.
          </li>
          <li>
            <strong>Create user</strong>: tên/họ, tên đăng nhập (kiểm tra tính khả
            dụng khi gõ), e-mail, mật khẩu với danh sách kiểm tra độ mạnh trực
            tiếp (8+ ký tự, chữ hoa & chữ thường, một số hoặc ký hiệu), và vai trò{" "}
            <Code>Member</Code> hoặc <Code>Administrator</Code>.
          </li>
          <li>
            Mỗi dòng có một nút <strong>Edit</strong> mở một hộp thoại cho mọi thứ
            về tài khoản đó, qua ba tab: <strong>General</strong> (<Code>Role</Code>{" "}
            Member/Administrator, <Code>Status</Code> Active/Disabled dưới dạng
            công tắc, một mật khẩu mới tuỳ chọn với danh sách yêu cầu trực tiếp -
            để trống cả hai ô mật khẩu để giữ mật khẩu hiện tại), <strong>
            Groups</strong> (bên dưới), và <strong>Global access</strong> (các
            override <strong>Workspace Global Access</strong> của nó - xem bên
            dưới). Một nút <strong>Delete</strong> riêng, chỉ có biểu tượng, xoá
            hoàn toàn tài khoản. Tài khoản của chính bạn và tài khoản admin khởi
            tạo được bảo vệ không bao giờ hiện các điều khiển này, nên bạn không
            bao giờ có thể tự khoá mình. Hộp thoại luôn lấy dữ liệu mới nhất của
            tài khoản này mỗi lần mở, thay vì dùng lại dòng trong danh bạ - mở lại
            ngay sau khi lưu một override luôn hiển thị đúng những gì đã được
            lưu, không phải những gì dòng đó tình cờ đang hiển thị.
          </li>
          <li>
            Tab <strong>Groups</strong> liệt kê mọi nhóm tài khoản này thuộc về,
            mỗi nhóm có nút <strong>Leave</strong> một-chạm - và cùng kiểu mẫu{" "}
            <strong>Select</strong> / chọn-tất-cả như chính danh bạ, để rời nhiều
            nhóm cùng lúc. Rời nhóm có hiệu lực ngay lập tức, không phải một phần
            của thao tác Save của hộp thoại.
          </li>
          <li>
            Một <Code>Administrator</Code> thông thường không thể Edit hoặc Delete
            một tài khoản <Code>Administrator</Code> khác, hay đặt lại mật khẩu
            của nó - chỉ admin khởi tạo được bảo vệ mới có thể. Điều này giữ cho
            một admin không thể hạ cấp, vô hiệu hoá hoặc khoá một admin khác; một
            Administrator thông thường vẫn có thể quản lý toàn bộ mọi tài khoản{" "}
            <Code>Member</Code>, bao gồm thăng cấp một người lên{" "}
            <Code>Administrator</Code>.
          </li>
          <li>
            Giữ <Code>Manage users</Code> mà không tự bản thân là một{" "}
            <Code>System administrator</Code> (dù <Code>Role</Code> của tài khoản
            đã là như vậy, hay một nhóm/override cấp <Code>System
            administrator</Code>) cố ý bị thu hẹp hơn: nó tạo, sửa, đặt lại mật
            khẩu và vô hiệu hoá tài khoản <Code>Member</Code>, và quản lý tư cách
            thành viên nhóm của họ, nhưng trường <strong>Role</strong> và toàn bộ
            tab <strong>Global access</strong> bị vô hiệu hoá - nó không bao giờ
            có thể thăng cấp hay hạ cấp ai, cấp một Global Access override (một
            override có thể cấp <Code>System administrator</Code> chắc chắn không
            kém gì Role), hay đụng đến một tài khoản <Code>Administrator</Code>{" "}
            hiện có. Cách duy nhất để có được bất kỳ điều đó là thực sự trở thành
            một <Code>System administrator</Code>.
          </li>
          <li>
            <strong>Select</strong> (cạnh ô tìm kiếm) bật một checkbox trên mỗi
            dòng và một thanh <strong>Delete selected</strong> để xoá nhiều tài
            khoản cùng lúc. Dòng của một tài khoản được bảo vệ, tài khoản của
            chính bạn, hoặc (trừ khi bạn là admin khởi tạo được bảo vệ) một tài
            khoản <Code>Administrator</Code> khác có checkbox bị vô hiệu hoá hoàn
            toàn thay vì để nó thất bại giữa chừng một lô.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Override Workspace Global Access:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Một tóm tắt <strong>Currently granted</strong> nằm phía trên bốn dòng
            quyền, liệt kê chính xác những gì tài khoản này đang có (hoặc{" "}
            <Code>All permissions (Administrator role)</Code> khi Role của nó đã
            bao trọn mọi thứ) - nơi duy nhất cần kiểm tra trước khi quyết định có
            cần thay đổi gì bên dưới không. Nó, cùng huy hiệu{" "}
            <Code>Active</Code>/<Code>Disabled</Code> riêng của mỗi dòng, cập nhật
            ngay khi bạn đổi Role hoặc một menu thả xuống override - không cần
            Save rồi mở lại hộp thoại chỉ để xem một lựa chọn có thực sự có hiệu
            lực không.
          </li>
          <li>
            Bốn quyền toàn cục (<Code>Create spaces</Code>, <Code>Manage
            users</Code>, <Code>Manage groups</Code>, <Code>System
            administrator</Code>) thường đến từ các nhóm của một người dùng. Hộp
            thoại Edit cho phép bạn đặt một trong ba trạng thái cho mỗi quyền,
            theo từng người: <Code>Inherit from groups</Code> (mặc định),{" "}
            <Code>Force enabled</Code>, hoặc <Code>Force disabled</Code> - override
            luôn thắng bất kể các nhóm của người đó nói gì về quyền đó.
          </li>
          <li>
            Điều này không ảnh hưởng đến một tài khoản có <Code>Role</Code> đã là{" "}
            <Code>Administrator</Code>: vai trò đó vô điều kiện cấp mọi quyền,
            giống như luôn vậy.
          </li>
          <li>
            <Code>Manage users</Code> mở khoá <strong>Administration &gt;
            Users</strong> và <Code>Manage groups</Code> mở khoá{" "}
            <strong>Administration &gt; Groups</strong> cho tài khoản đó, dù
            quyền đến từ một nhóm hay một override ở đây - mỗi quyền chỉ mở đúng
            phần tương ứng của nó, không phải toàn bộ Administration.{" "}
            <Code>Create spaces</Code> chỉ mở khoá nút <strong>Create space</strong>{" "}
            trên danh bạ Spaces thông thường (xem &ldquo;Tạo một Space&rdquo; ở
            trên); nó không mở <strong>Administration &gt; Spaces</strong>, vốn
            vẫn là một góc nhìn giám sát chỉ dành cho <Code>System
            administrator</Code> (lưu trữ hoặc xoá vĩnh viễn bất kỳ space nào) -
            giống như Settings, Backup và Storage.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">3. Tab Administrators:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Liệt kê mọi tài khoản hiện đang có quyền truy cập{" "}
            <Code>System administrator</Code> bất kể có được bằng cách nào - công
            tắc <Code>Role</Code>, một quyền toàn cục của nhóm, hay một override
            theo từng user - với một cột <strong>Granted via</strong> nói rõ là
            cách nào. Bộ lọc Role trên danh bạ People chỉ hiển thị cái đầu tiên
            trong ba cách này.
          </li>
          <li>
            Dưới <strong>Granted via</strong>, một cấp quyền qua Role hoặc
            override cũng nêu tên <strong>ai</strong> đã làm việc đó - tài khoản
            đã bật công tắc hoặc thêm override, đọc từ nhật ký kiểm toán. Một cấp
            quyền qua nhóm thay vào đó nêu tên <strong>nhóm nào</strong>: tư cách
            thành viên nhóm và quyền cấp riêng của một nhóm không được theo dõi
            theo từng thành viên, nên không có một người cụ thể để chỉ ra ở đó.
            Cả hai có thể hiện là không xác định được nguồn với một tài khoản đã
            có quyền này từ trước khi việc theo dõi này tồn tại.
          </li>
          <li>
            <strong>Demote to Member</strong> hoàn tác lại đúng cách nó đã được
            cấp: nó chuyển <Code>Role</Code> về lại Member với một Administrator
            trực tiếp, hoặc thêm một override force-disabled với một tài khoản
            được cấp qua nhóm hoặc một override có sẵn. Bị vô hiệu hoá với admin
            được bảo vệ, tài khoản của chính bạn, hoặc quản trị viên cuối cùng còn
            lại trong danh sách - và, với một Administrator trực tiếp (Granted
            via: <Code>Administrator role</Code>), bị vô hiệu hoá với bất kỳ ai
            ngoại trừ admin khởi tạo được bảo vệ, giống như Edit/Delete trong danh
            bạ People.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">4. Tab Permission overrides:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Liệt kê mọi tài khoản có ít nhất một override <strong>Global
            access</strong> - <Code>Create spaces</Code>, <Code>Manage
            users</Code>, <Code>Manage groups</Code>, hoặc <Code>System
            administrator</Code>, bị ép <Code>Enabled</Code> hoặc{" "}
            <Code>Disabled</Code> riêng cho tài khoản đó. Trước khi tab này tồn
            tại, cách duy nhất để tìm ra ai có một quyền tuỳ chỉnh là mở hộp thoại
            Edit của từng tài khoản một và kiểm tra tab Global access của nó -
            tab này tồn tại chính xác để việc đó không bao giờ cần thiết nữa.
          </li>
          <li>
            Cột <strong>Overrides</strong> của mỗi dòng nêu tên chính xác những
            quyền nào bị override và thành giá trị nào - một tài khoản kế thừa
            mọi thứ bình thường từ Role hoặc nhóm của nó sẽ không bao giờ xuất
            hiện ở đây.
          </li>
          <li>
            Cùng các hành động <strong>Edit</strong>/<strong>Delete</strong> như
            danh bạ People có ngay trên dòng đó, nên hành động dựa trên những gì
            bạn thấy - sửa hoặc xoá một override - không bao giờ có nghĩa là phải
            chuyển sang tab khác trước.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">5. Groups:</p>
        <Screenshot
          src="/help/admin-groups-directory.png"
          alt="Danh bạ Groups: số lượng nhóm và tổng thành viên được gán, ô tìm kiếm, và một bảng liệt kê chủ sở hữu, số thành viên, global access, và các quyền truy cập của từng nhóm"
          caption="Danh bạ Groups - chủ sở hữu, thành viên, global access, và quyền truy cập trong nháy mắt."
        />
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Groups gộp người dùng lại để cấp quyền theo space có thể tái sử dụng -
            gán một nhóm một lần trong bảng <strong>Access</strong> của một space
            thay vì thêm từng thành viên riêng lẻ.
          </li>
          <li>
            Mỗi nhóm cũng có thể mang <strong>quyền toàn cục</strong>: Create
            spaces, Manage users, Manage groups, System admin.
          </li>
          <li>
            <strong>Group directory</strong> và <strong>Global access</strong> là
            hai tab riêng phía trên bảng, cùng kiểu chia như Administration &gt;
            Users. Group directory liệt kê mọi nhóm; Global access thu hẹp xuống
            chỉ những nhóm (thường không nhiều) thực sự cấp một trong bốn quyền
            toàn cục ở trên - những nhóm đáng để kiểm tra lại trước khi thêm ai
            đó vào, trong số một danh sách nhóm dài hơn nhiều tồn tại thuần tuý
            cho quyền truy cập Space/Page.
          </li>
          <li>
            Các nhóm hệ thống mặc định (<Code>administrators</Code>,{" "}
            <Code>users</Code>, <Code>confluence-administrators</Code>,{" "}
            <Code>confluence-users</Code>) không thể bị xoá, chỉ có thể chỉnh sửa.
          </li>
          <li>
            Một nhóm vẫn đang cấp quyền truy cập cho bất kỳ Space nào hoặc có giới
            hạn trên bất kỳ Page nào không thể bị xoá -{" "}
            <strong>&quot;Remove this group&apos;s permission assignments
            before deleting it&quot;</strong> nghĩa chính xác như vậy, và cả hai
            phải được xoá trước (quyền toàn cục của nó, trong Edit &gt; Global
            access, không tính - chỉ các cấp quyền Space/Page mới tính).
          </li>
          <li>
            Cột <strong>Access grants</strong> của bảng Directory nêu số lượng
            Space và Page mà một nhóm được cấp quyền truy cập - <Code>Not
            used</Code> nghĩa là nó có thể bị xoá ngay. Nhấn vào số lượng sẽ mở
            một danh sách xem nhanh liệt kê từng cái theo tên, mỗi cái liên kết
            thẳng đến Space hoặc Page đó, kèm nút <strong>Remove</strong> riêng
            ngay tại chỗ để xoá quyền cấp ngay lập tức - không cần lục qua từng
            bảng Access của từng Space trước. Cùng danh sách đó, với cùng nút
            Remove, cũng là một tab riêng (<strong>Access grants</strong>) bên
            trong hộp thoại Edit Group đầy đủ, ngay cạnh Members.
          </li>
          <li>
            Cùng điều khiển <strong>Select</strong> / xoá hàng loạt như danh bạ
            People có sẵn cạnh ô tìm kiếm nhóm; một nhóm hệ thống mặc định vẫn bị
            loại trừ ngay cả khi được chọn.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "admin-spaces-access",
    title: "Quyền truy cập Space & Quyền hiệu lực",
    category: "Administration",
    description:
      "Cấp quyền theo space cho người dùng hoặc nhóm, và kiểm tra chính xác những gì một người có thể làm trong một space.",
    keywords: [
      "space access",
      "quyền truy cập space",
      "permissions",
      "quyền",
      "effective permissions",
      "quyền hiệu lực",
      "groups",
      "nhóm",
      "restrict",
      "giới hạn",
      "archived spaces",
      "archived spaces tab",
      "space directory",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Spaces</strong> liệt kê mọi space với các ô
          Total / Active / Archived. Xoá space vĩnh viễn chỉ khả dụng ở đây (cài
          đặt riêng của một space chỉ có tuỳ chọn Archive). Mở bảng{" "}
          <strong>Access</strong> của một space để quản lý chính xác ai được làm
          gì:
        </p>

        <Screenshot
          src="/help/admin-spaces-directory.png"
          alt="Danh bạ Administration Spaces: các ô Total/Active/Archived/Member assignments, ô tìm kiếm, và bảng các space với khả năng hiển thị, số lượng người dùng có bản quyền, trạng thái, và thao tác Edit/Delete"
          caption="Administration > Spaces - góc nhìn giám sát đầy đủ, với xoá vĩnh viễn chỉ khả dụng ở đây."
        />

        <Callout variant="note" title="SPACE DIRECTORY SO VỚI ARCHIVED SPACES">
          Hai tab phía trên bảng, cùng kiểu chia như Administration &gt; Users và
          Groups: <strong>Space directory</strong> liệt kê mọi space đang hoạt
          động, <strong>Archived spaces</strong> chỉ liệt kê những space bị ẩn
          khỏi điều hướng thông thường - khôi phục một space từ chính{" "}
          <em>Edit space &gt; Space settings &amp; Danger zone</em> của nó, hoặc
          xoá vĩnh viễn ngay từ một trong hai tab.
        </Callout>

        <Screenshot
          src="/help/admin-spaces-access.png"
          alt="Tab Access & Permissions của Edit space: General access đặt là Restricted, một bảng quyền theo nhóm, và một bảng quyền theo người dùng với các cột View/Add-Edit/Delete/Delete own/Restrictions/Move/Admin"
          caption="Access & Permissions - General access, một bảng Group, và một bảng Individual user."
        />

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>General access</strong>: <Code>Open</Code> tự động cấp cho
            mọi người dùng đã đăng nhập toàn quyền đọc/ghi (mọi thứ trừ{" "}
            <Code>Admin</Code>/<Code>Restrictions</Code>) - một banner cảnh báo
            nói rõ điều này ngay phía trên các bảng. <Code>Restricted</Code> rút
            lại điều đó, nên chỉ những người được cấp rõ ràng bên dưới mới có thể
            làm bất cứ điều gì.
          </li>
          <li>
            <strong>Space Owner</strong> (đặt từ tab <strong>Edit space &gt;
            General</strong> của chính space, không phải ở đây): một
            Administrator được bảo vệ mà một space luôn giữ ít nhất một, để nó
            không bao giờ trở nên không thể quản lý bất kể chuyện gì xảy ra với
            các bảng bên dưới.
          </li>
          <li>
            Một bảng quyền <strong>Groups</strong> và một bảng quyền{" "}
            <strong>Individual users</strong>, mỗi bảng có checkbox cho{" "}
            <Code>View</Code>, <Code>Add/Edit</Code>, <Code>Delete</Code>,{" "}
            <Code>Delete own</Code>, <Code>Restrictions</Code>, <Code>Move</Code>,
            và <Code>Admin</Code>. <Code>View</Code> chỉ cấp quyền đọc - chỉnh sửa
            cần thêm <Code>Add/Edit</Code>, và di chuyển một trang cần thêm{" "}
            <Code>Move</Code>. Xuất tệp tự động theo <Code>View</Code> và không
            phải một checkbox riêng. Khi space đang ở chế độ <Code>Open</Code>,
            năm cột đầu hiển thị <Code>All</Code> thay vào đó - Open đã cấp sẵn
            cho mọi người, nên một checkbox ở đó sẽ không thực sự thay đổi gì;{" "}
            <Code>Restrictions</Code>/<Code>Admin</Code> vẫn hoạt động bất kể chế
            độ nào. Thay đổi diễn ra rõ ràng - Edit, rồi Save hoặc Cancel - kèm
            cảnh báo thay đổi chưa lưu nếu bạn rời đi giữa chừng.
          </li>
          <li>
            <strong>Effective permissions</strong>: chọn một người dùng bất kỳ và
            xem tập quyền đã được phân giải đầy đủ của họ cho space đó - quyền
            truy cập Open, một quyền cấp trực tiếp (ghi đè mọi nhóm họ thuộc về
            một khi đã có, trừ Admin), hoặc nếu không thì mọi nhóm họ thuộc về
            kết hợp lại - thay vì phải đối chiếu thủ công ba nguồn khác nhau.
          </li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          Trường hợp thực tế: trước khi chuyển một space sang Restricted, dùng{" "}
          <strong>Effective permissions</strong> để xác nhận tài khoản nhà thầu
          duy nhất vẫn cần quyền đọc thực sự vẫn còn giữ được quyền đó.
        </p>
      </>
    ),
  },
  {
    id: "switch-account",
    title: "Switch Account (Giả lập tài khoản)",
    category: "Administration",
    description:
      "Superuser có thể xem WikiHub đúng như cách một người dùng khác thấy, để gỡ lỗi vấn đề quyền hoặc tái hiện báo cáo lỗi.",
    keywords: ["impersonate", "giả lập", "switch account", "debug", "gỡ lỗi", "superuser", "view as"],
    body: (
      <>
        <p>
          Superuser khi chưa giả lập ai sẽ thấy một điều khiển{" "}
          <strong>Switch account</strong> (biểu tượng người) trong menu tài
          khoản, liệt kê các tài khoản đang hoạt động khác. Chọn một tài khoản sẽ
          đăng nhập bạn dưới danh nghĩa họ mà không cần trao đổi mật khẩu - hữu
          ích để xác nhận &ldquo;tại sao người này không thấy trang kia&rdquo; mà
          không cần yêu cầu họ chia sẻ màn hình.
        </p>

        <Screenshot
          src="/help/switch-account.png"
          alt="Menu tài khoản, hiển thị tên tài khoản đang đăng nhập và một nút biểu tượng Switch account cạnh nó"
          caption="Điều khiển Switch account, cạnh tên của chính bạn trong menu tài khoản."
        />

        <Callout variant="warning" title="MỌI HÀNH ĐỘNG ĐỀU ĐƯỢC GHI NHẬN VÀ HIỂN THỊ">
          Trong khi giả lập, một banner cố định được ghim ở đáy mọi màn hình:
          &ldquo;Viewing WikiHub as <strong>{"{name}"}</strong>. Your actions are
          recorded against {"{impersonator}"}.&rdquo; Menu tài khoản cũng hiển
          thị <Code>Signed in as {"{impersonator}"}</Code>. Nhấn{" "}
          <strong>Return to my account</strong> (trong banner hoặc menu) để kết
          thúc phiên.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Tài khoản admin khởi tạo được bảo vệ và tài khoản của chính bạn bị loại
          khỏi danh sách chuyển đổi.
        </p>
      </>
    ),
  },
  {
    id: "backup-and-restore",
    title: "Sao lưu, Nhập Confluence & Xuất DC",
    category: "Administration",
    description:
      "Hai định dạng xuất riêng biệt, tải lên nhiều gigabyte có thể tiếp tục, một lịch trình định kỳ, và các kiểm tra an toàn ngăn sai kho lưu trữ rơi vào sai chỗ.",
    keywords: [
      "backup",
      "sao lưu",
      "zip",
      "restore",
      "khôi phục",
      "confluence",
      "import",
      "nhập",
      "export",
      "xuất",
      "xml",
      "datacenter",
      "resume",
      "tiếp tục",
      "sha-256",
      "automatic",
      "automated",
      "scheduled",
      "schedule",
      "lịch trình",
      "retention",
      "cron",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Backup</strong> có hai phần:{" "}
          <strong>Export / Backup</strong> và <strong>Import / Restore</strong>.
        </p>

        <Screenshot
          src="/help/backup-panel.png"
          alt="Bảng Export & Backup: Export WikiHub Backup và Export Confluence Backup cạnh nhau, và một phần Automatic backups với lịch trình định kỳ"
          caption="Export & Backup - hai định dạng xuất, và lịch trình sao lưu tự động bên dưới."
        />

        <p className="mt-3 font-semibold text-foreground">
          1. Hai định dạng xuất - không thể thay thế cho nhau:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Export WikiHub Backup</strong>: một tệp <Code>.zip</Code> gốc,
            có thể khôi phục, gồm space, trang, phiên bản, tệp đính kèm, người
            dùng, và nhóm - giới hạn theo <strong>All spaces</strong> hoặc một
            tập con đã chọn qua <strong>Select spaces to export</strong>.
          </li>
          <li>
            <strong>Export Confluence Backup</strong>: một kho lưu trữ XML cho
            công cụ khôi phục riêng của Atlassian Confluence Data Center, nhắm
            đến <strong>Data Center 8.x</strong> hoặc <strong>9.x</strong>. Đây
            là một sự chuyển giao một chiều - nó không thể dùng để khôi phục lại
            chính WikiHub.
          </li>
        </ul>

        <Callout variant="warning" title="INCLUDE PASSWORD HASHES = CẨN THẬN KHI DÙNG">
          Checkbox <strong>Include password hashes</strong> của bản sao lưu
          WikiHub mặc định tắt và được cảnh báo rõ ràng là cho phép dò mật khẩu
          ngoại tuyến nếu kho lưu trữ bị rò rỉ - chỉ bật nó cho một cuộc di
          chuyển thực sự, và lưu tệp ở nơi an toàn.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">2. Khôi phục / Nhập:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            Cả khôi phục bản sao lưu WikiHub lẫn <strong>Confluence Archive
            Import</strong> đều tải lên dưới dạng truyền tải nhiều gigabyte,
            chia theo phần, có thể tiếp tục, với các điều khiển{" "}
            <strong>Pause upload</strong> / <strong>Resume upload</strong> - an
            toàn để bắt đầu, tạm dừng, và tiếp tục sau mà không cần gửi lại những
            gì đã tải thành công.
          </li>
          <li>
            Nhập Confluence quét kho lưu trữ để tìm space, đánh dấu xung đột
            khoá, cho bạn chọn space nào để mang vào, và chạy như một tác vụ nền
            với log trực tiếp.
          </li>
          <li>
            Một kho lưu trữ Confluence lớn có thể mất hàng giờ để tải lên. Trang
            này tự động gia hạn phiên trình duyệt của bạn miễn là tab đó vẫn mở -
            bạn không cần giữ đăng nhập thủ công, và các tab khác vẫn hoạt động
            bình thường trong suốt quá trình.
          </li>
          <li>
            Khôi phục vào một instance đã có sẵn space sẽ kích hoạt một bước xung
            đột <strong>Replace existing spaces?</strong> cho bất cứ thứ gì có
            thể va chạm.
          </li>
        </ul>

        <Callout variant="tip" title="HAI LỚP AN TOÀN CHỐNG SAI TỆP">
          Một kiểm tra phía client bắt lỗi tải lên rõ ràng sai ngay lập tức - vd.
          chọn một bản xuất Confluence dưới mục khôi phục WikiHub sẽ hiện{" "}
          <em>
            &ldquo;This is a Confluence export, not a WikiHub backup. Upload it
            under &lsquo;Import Confluence Backup&rsquo; instead.&rdquo;
          </em>{" "}
          trước khi bất cứ điều gì bắt đầu tải lên. Riêng biệt, tiếp tục một lần
          tải lên bị gián đoạn với một tệp <em>khác</em> so với tệp đã tải một
          phần sẽ hiện hộp thoại{" "}
          <strong>&ldquo;That is a different file&rdquo;</strong>, so sánh tệp
          đang được tải với tệp bạn vừa chọn (tên, kích thước, đã lưu được bao
          nhiêu) và hỏi bạn <strong>Discard and upload this</strong> hoặc{" "}
          <strong>Choose the original</strong>.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">3. Sao lưu tự động (theo lịch):</p>
        <p>
          Bảng <strong>Automatic backups</strong>, phía trên{" "}
          <strong>Export / Backup</strong>, chạy một <strong>Export WikiHub
          Backup</strong> định kỳ theo lịch mà không ai cần nhấn gì cả.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm mt-2">
          <li>
            Nó ghi mỗi bản sao lưu vào một thư mục được mount vào chính server (
            <Code>WIKIHUB_AUTOMATED_BACKUP_HOST_DIRECTORY</Code> trong môi trường
            triển khai) thay vì object storage - một bản sao riêng trên hạ tầng
            riêng, để một sự cố với storage chính không làm mất luôn cả bản sao
            lưu của nó. <strong>Enabled</strong> vẫn bị làm mờ, và{" "}
            <strong>Run now</strong> vẫn bị vô hiệu hoá, cho đến khi một người
            vận hành thực sự đã mount thư mục đó.
          </li>
          <li>
            <strong>Subfolder (optional)</strong> giới hạn sao lưu vào một thư
            mục con bên dưới volume đã mount, vd. <Code>team-a</Code> ghi vào{" "}
            <Code>&lt;mounted volume&gt;/team-a</Code> thay vì gốc của volume -
            hữu ích để giữ đầu ra của nhiều lịch trình tách biệt nhau. Thư mục
            phải đã tồn tại trên host: <strong>Save schedule</strong> kiểm tra nó
            với hệ thống tệp thực và từ chối một đường dẫn không tồn tại hoặc sẽ
            phân giải ra ngoài volume đã mount, kèm lý do hiển thị ngay dưới
            trường đó.
          </li>
          <li>
            Cấu hình <strong>Every N hours/days</strong>, một{" "}
            <strong>Start time</strong> và <strong>Timezone</strong> (một tên
            múi giờ IANA, vd. <Code>Asia/Ho_Chi_Minh</Code>), và số bản sao lưu
            hoàn tất cần <strong>Keep</strong> - các bản cũ hơn số đó bị xoá tự
            động khi bản mới xuất hiện. Nhấn <strong>Save schedule</strong> để áp
            dụng; bảng sau đó hiển thị thời gian <strong>Last run</strong> và{" "}
            <strong>Next run</strong> đã tính toán.
          </li>
          <li>
            <strong>Run now</strong> xếp hàng một bản ngay lập tức mà không cần
            chờ lịch trình hay làm gián đoạn nó. Danh sách bên dưới hiển thị các
            bản sao lưu theo lịch gần đây với <strong>Download</strong> và{" "}
            <strong>Delete</strong> cho mỗi bản.
          </li>
        </ul>

        <Callout variant="warning" title="LUÔN BAO GỒM PASSWORD HASHES">
          Không giống <strong>Export WikiHub Backup</strong> thủ công, một bản
          sao lưu theo lịch luôn bao gồm password hashes - không có công tắc cho
          việc này, vì không có ai hiện diện để chọn mỗi lần. Hạn chế quyền truy
          cập vào thư mục đã mount giống như bất kỳ kho lưu trữ thông tin đăng
          nhập nào khác.
        </Callout>
      </>
    ),
  },
  {
    id: "safe-operation",
    title: "Vận hành an toàn & Xử lý sự cố hệ thống",
    category: "Administration",
    description:
      "Ngăn mất dữ liệu, xử lý lỗi tải lên, và theo dõi các worker chạy nền.",
    keywords: ["security", "bảo mật", "troubleshooting", "xử lý sự cố", "failed", "upload", "tải lên", "access", "redis", "minio"],
    body: (
      <>
        <p>
          Các thực hành tốt nhất để duy trì sự ổn định của workspace và giải
          quyết các vấn đề kỹ thuật:
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm mt-2">
          <li>
            <strong>Vấn đề quyền truy cập & Quyền hạn</strong>: Nếu một người
            dùng không thể thấy một trang hoặc space, hãy kiểm tra{" "}
            <em>Space access</em>, giới hạn <em>Page access</em>, và tư cách
            thành viên nhóm - hoặc chỉ cần mở <strong>Effective
            permissions</strong> trong bảng Access của space cho người dùng đó và
            xem câu trả lời đã phân giải trực tiếp thay vì đối chiếu cả ba nguồn
            bằng tay.
          </li>
          <li>
            <strong>Lỗi tải lên</strong>: Kiểm tra giới hạn kích thước tệp và
            phần mở rộng được phép trong <strong>Settings</strong>. Đảm bảo
            object storage MinIO/S3 đang hoạt động khoẻ mạnh và phản hồi tốt.
          </li>
          <li>
            <strong>Lỗi Import Worker</strong>: Kiểm tra log tác vụ worker chạy
            nền, kết nối hàng đợi Redis, và dung lượng đĩa còn trống. Các kho lưu
            trữ đã quét có thể được tiếp tục từ bảng Backup.
          </li>
          <li>
            <strong>Tài liệu API</strong>: Quản trị viên có thể truy cập tài
            liệu OpenAPI / Swagger tương tác tại <Code>/docs</Code> và ReDoc tại{" "}
            <Code>/redoc</Code>.
          </li>
        </ul>

        <Callout variant="note" title="ĐẶT KỲ VỌNG ĐÚNG: NHỮNG GÌ WIKIHUB CHƯA LÀM">
          Ba thứ mọi người thường đi tìm nhưng chưa tồn tại trong bản build này,
          nên đáng để biết trước khi bạn đi tìm: không có luồng mời qua e-mail
          (tài khoản được tạo trực tiếp - xem <em>Quản lý người dùng & Nhóm</em>),
          không có hệ thống thông báo (không có biểu tượng chuông, không có cảnh
          báo theo dõi trang/@-mention - thứ gần nhất là luồng hoạt động trên
          Home và Recently visited/worked on), và không có trình xem nhật ký kiểm
          toán trong ứng dụng (hành động của admin và việc giả lập tài khoản
          được ghi log phía server, nhưng chưa có nơi nào trong giao diện để
          duyệt log đó).
        </Callout>
      </>
    ),
  },
];
