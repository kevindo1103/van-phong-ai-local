# Văn phòng AI Local – bản tùy chỉnh cho ThinkPad

Fork từ [vinaichatbot-rgb/van-phong-ao-3d](https://github.com/vinaichatbot-rgb/van-phong-ao-3d).
Mục tiêu: giám sát các phiên Claude Code và Codex chạy trên **máy Windows**, không đụng vào repository Bingxue ERP và không cần Docker.

## Chạy nhanh trên ThinkPad

Vị trí đã thiết lập: `D:\AI-Office-Local`.

    cd D:\AI-Office-Local
    npm ci
    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

Mở **http://127.0.0.1:7788**. Khi cần dừng, nhấn Ctrl+C trong cửa sổ chạy server.

Script chỉ tạo `config.json` và `data/` nếu chưa tồn tại; **không thêm gì vào AGENTS.md hoặc CLAUDE.md của ERP**. Nếu máy không có `D:\BINGXUE_ERP`, script khởi tạo với mọi dự án; có thể chỉnh lại `projects` trong config.

## Phòng làm việc và phân quyền theo prefix

Mỗi vai có phòng 3D/2D riêng; Claude Code và Codex dùng cùng quy tắc, không phân phòng theo nền tảng:

| Prefix đầu tên phiên | Phòng / chủ sở hữu |
|---|---|
| `CEO`, hoặc tên mở đầu `Kyle` | CEO · Kyle |
| `Backend` / `Bob` | Backend · Bob |
| `Frontend` / `Dave` | Frontend · Dave |
| `Product` / `Stu` | Product · Stu |
| `QC`, `Infra` / `Gru` | QC & Infra · Gru |
| `PM` / `James` | PM · James |
| Không rõ tên/prefix | Khu vực chung · Chưa có tên |

Ví dụ: `Infra: Fix VPS61`, `[QC] Smoke test`, `Backend - B04 API`.
Tên chỉ nhắc từ Backend/QC/Infra ở giữa câu (không có prefix) **không được** tự đoán phòng.

**Gán thủ công:** nhấn vào session trong văn phòng 3D hoặc sơ đồ 2D rồi chọn phòng. Mapping được lưu tại `data/session-rooms.json` trên ThinkPad, không đẩy lên GitHub. Chọn **Tự phân phòng lại theo prefix** trong 3D để xóa gán thủ công. Các session mang trạng thái `DEV` hoặc `chờ DEV` có thể tạm di chuyển đến khu DEV nhưng phòng sở hữu vẫn giữ nguyên.

## Góc nhìn và cách dùng giao diện

- Mở `http://127.0.0.1:7788`: mặc định là **Văn phòng 3D** phóng lớn, không tải ba màn hình dashboard ở phía sau để giảm rối và tiết kiệm tài nguyên.
- Bảng **Đội AI · Phòng ban** bên phải: xem số phiên mỗi phòng; bấm tên phòng để camera phóng to. Bấm từng session để xem trạng thái, chọn phòng thủ công.
- Bấm **Hiện tất cả** (hoặc nút **Văn phòng** góc trái) để quay về toàn bộ các phòng.
- Bấm **Toàn cảnh** để xem lại cả ba màn hình dashboard trong không gian 3D. Các nút Công việc / Xem màn hình lớn / Nội quy vẫn mở dashboard toàn màn hình như trước.
- Các nhãn tên robot được thu gọn ở góc nhìn tổng quan để không chồng chữ; khi chọn một phòng, nhãn của các phiên trong phòng đó sẽ hiển thị đầy đủ.
- Nếu máy yếu, mở `http://127.0.0.1:7788/2d.html` để xem sơ đồ 2D.

## An toàn mặc định

- `host: "127.0.0.1"`: không lắng nghe từ LAN. Khách từ xa bị từ chối nếu không cấu hình khóa xem.
- Khóa xem `accessKey` (nếu được bật) được gửi qua POST, không nằm trong URL hay lịch sử trình duyệt. Cookie phiên chỉ tồn tại trong phiên server; khóa không nằm trong repo nhờ .gitignore.
- Giao diện nhắn tin từ xa dùng PIN riêng; mỗi lần nhập sai đều bị tính vào giới hạn (5 lần trong 10 phút), không lệ thuộc header do client cung cấp.
- `showSessionContent: false` (mặc định): ẩn nội dung hội thoại và message event ở dashboard; backend vẫn đọc nhật ký **trên máy** để suy luận trạng thái và đếm token. Sổ việc/nội quy do người dùng chủ động ghi trong `data/` vẫn hiển thị.
- `showHeuristicGrades: false` (mặc định): không chấm A/B/C/D vì số lượt trả lời không phải số task được nghiệm thu.
- Three.js 0.160.0 được cài qua `npm ci` và phục vụ từ `node_modules/three` tại chính localhost; giao diện 3D không tải từ CDN khi sử dụng.
- Nếu muốn xem trên điện thoại, trước hết cần tự đặt khóa mạnh (tối thiểu 16 ký tự ngẫu nhiên) và xem lại dữ liệu có thể công khai. **Không tự mở cloudflared/tunnel**. Chỉ mở theo quyết định riêng.

**Không bảo đảm che sạch mọi bí mật bằng regex**. Không bật `showSessionContent` khi chia sẻ ngoài máy. Không dùng công cụ này làm nơi lưu secrets.

## Điều phối DEV và những gì hệ thống KHÔNG làm

- Lệnh `node tools/vp.js luot lay ...` dùng tạo file riêng kiểu O_EXCL: hai agent không thể đồng thời lấy cùng một khóa. Hàng chờ FIFO được kiểm tra.
- `luot nha` chỉ cho đúng vai đang giữ nhả; từ chối nếu thiếu/không đọc được khóa.
- Nếu agent chết, `data/DEV.lock` được **giữ nguyên để bảo vệ**. Kiểm tra rằng không còn tác vụ deploy/test dùng môi trường, thông báo với các agent rồi mới xử lý khóa kẹt bằng tay. Không tự hết hạn và không tự xóa.
- Đây là **khóa cộng tác**, không phải quyền kiểm soát hạ tầng: tiến trình bỏ qua công cụ `vp` vẫn có thể deploy. GitHub Actions và VPS vẫn phải có concurrency gate độc lập.
- Trạng thái active/idle/blocked được **suy luận từ log**, không phải giám sát tác vụ ở mức hệ điều hành. 3D là phần hiển thị, không phải engine tạo hoặc điều phối phiên AI.
- Hòm thư chỉ là tệp ghi việc; agent cần tự đọc `vp tiep` theo hướng dẫn. Không có cam kết exactly-once, retries hoặc scheduler như message queue thực thụ.
- Lượt kết thúc, tỷ lệ lỗi công cụ, token và chi phí ước tính **không** phải số task đã nghiệm thu, chất lượng code hay hóa đơn sử dụng API.
- Không tự lấy trạng thái CI/PR GitHub. ERP Project Board và GitHub là nguồn chuẩn cho backlog, pull request và quality gate.

## Kiểm thử & bảo trì

    npm run check
    npm test

Test tích hợp dùng `node:test`; dữ liệu thử nghiệm nằm trong thư mục tạm và được xóa sau khi chạy. CI chạy trên Windows và Ubuntu.

Để cập nhật upstream, trước hết xem khác biệt và giữ các bản vá local:

    git fetch upstream
    git log --oneline main..upstream/main

Không tự merge bản gốc nếu các test, an toàn và đặc thù Windows chưa được xác minh.

## Cấu hình

Tùy chọn trong `config.json` (được .gitignore):

- `projects`: danh sách đường dẫn Windows (sử dụng dấu / cho dễ đọc); để `[]` là mọi dự án local.
- `staff`: ghép tên phiên với vai và phòng cho giao diện.
- `showSessionContent`: `false` mặc định.
- `showHeuristicGrades`: `false` mặc định.
- `port`: `7788`; `host`: `127.0.0.1`.
- `accessKey`: chuỗi rỗng mặc định (chỉ cho xem local).

Nếu màn 3D đen, kiểm tra `node_modules/three/build/three.module.js` (chạy lại `npm ci`) hoặc mở Sơ đồ 2D. Đường dẫn /vendor/three phải trả HTTP 200 và JS MIME.

Giấy phép mã nguồn: MIT theo upstream.
