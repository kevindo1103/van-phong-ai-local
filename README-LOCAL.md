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
| `QC` / `Agnes` | QC · Agnes |
| `Infra` / `Gru` | Infra · Gru |
| `PM`, `Project` / `James` | PM · James |
| `Docs` / `Edith` | Docs · Edith |
| Không rõ tên/prefix | Chưa phân công |

Ví dụ: `Infra: Fix VPS61`, `[QC] Smoke test`, `Backend - B04 API`.
Tên chỉ nhắc từ Backend/QC/Infra ở giữa câu (không có prefix) **không được** tự đoán phòng.

**Gán thủ công:** nhấn vào session trong văn phòng 3D hoặc sơ đồ 2D rồi chọn phòng. Mapping được lưu tại `data/session-rooms.json` trên ThinkPad, không đẩy lên GitHub. Chọn **Tự phân phòng lại theo prefix** trong 3D để xóa gán thủ công. Các session mang trạng thái `DEV` hoặc `chờ DEV` có thể tạm di chuyển đến khu DEV nhưng phòng sở hữu vẫn giữ nguyên.

## Kết nối các phiên ChatGPT Work

Các mục Recents trong ChatGPT Work (cloud) không đồng nghĩa với session Claude Code / Codex CLI trên máy. Phần lớn chúng không được đồng bộ tự động qua nhật ký CLI. Không thể khẳng định đang làm chỉ từ tên một cuộc trò chuyện.

Văn phòng có cầu nối Work heartbeat (chỉ ghi metadata local), theo cơ chế opt-in qua Remote Desktop Commander:

    cd D:\AI-Office-Local
    node tools/work-session.js list
    node tools/work-session.js heartbeat --id backend-bob --name "Backend - Bob" --state active
    node tools/work-session.js heartbeat --id backend-bob --state done
    node tools/work-session.js status --id project-james
    node tools/work-session.js heartbeat --id project-james --state active

- register --id backend-bob --name "Backend - Bob": chỉ tạo bản ghi với trạng thái **Chưa kết nối**.
- heartbeat --state active: xác nhận phiên đang xử lý; idle, done, blocked dùng khi thay đổi trạng thái.
- Heartbeat `active` chỉ có hiệu lực 5 phút; sau đó hiện **ACTIVE · CŨ** (màu trung tính và tuổi tín hiệu), không tiếp tục đếm là đang làm. Đó là trạng thái được báo lần cuối, **không** xác nhận phiên Work còn chạy.
- Heartbeat `idle`/`done` được giữ làm **IDLE · CŨ** tối đa 24 giờ. `blocked` cũ hiển thị **BLOCKED · CŨ** nhưng không tính là blocker đang hoạt động; hết 24 giờ chuyển về trạng thái chưa rõ. Các trạng thái cũ kèm thời điểm heartbeat cuối, không được coi là tín hiệu đang chạy.
- Mỗi session dùng một --id ổn định riêng: backend-bob-b04, backend-bob-inventory cho nhiều phiên Backend.
- Mặc định chỉ lưu tên, mã session, trạng thái, thời điểm; không đọc nội dung chat, file dự án hoặc token. Nếu agent **chủ động gửi**, bridge còn nhận mô tả ngắn `--task`, `--progress`, `--blocker`. Các mô tả được lưu trong `data/work-sessions/` (chỉ local, không commit). Không đưa secret hoặc dữ liệu cá nhân vào các mô tả này.
- Để thấy Bob đang làm gì khi bấm vào robot, chính phiên Bob cần gửi ví dụ: `node D:\\AI-Office-Local\\tools\\work-session.js heartbeat --id backend-bob --state active --task "Kiểm tra API B04" --progress "Đang review" --blocker "Chờ QC"`. Các chuỗi trong ví dụ chỉ minh họa, không phải kết quả thực tế của Bob.
- Heartbeat sau đó chỉ có `--state` vẫn giữ nguyên mô tả cuối. Khi hết vướng mắc: `--clear-blocker`. Bảng chi tiết luôn ghi rõ đây là báo cáo agent và thời điểm cập nhật, không tự suy luận từ tên Recents.
- Work agent có Remote Desktop Commander trên ThinkPad phải tự gọi heartbeat khi bắt đầu, trong lúc làm việc (mỗi 2–3 phút) và lúc kết thúc. Ví dụ James: `node D:\AI-Office-Local\tools\work-session.js heartbeat --id project-james --state active`. Sau khi đăng ký, chỉ cần ID và state, không cần nhắc lại tên. Nếu agent đang thực hiện một tool call kéo dài thì không thể báo heartbeat trong khi chính tool call đó đang chặn; UI sẽ ghi `ACTIVE · CŨ` cho tới lần cập nhật tiếp theo. Đây không phải API tự động truy cập trạng thái các phiên ChatGPT cloud.
- Các tên trong ảnh được đăng ký local ở data/work-sessions/ với trạng thái Chưa kết nối; không được xem là bằng chứng chúng đang hoạt động.
- Nếu phiên Work báo **EPERM**, kiểm tra thông báo cấp quyền của công cụ trong chính phiên đó: cho phép gọi Desktop Commander và lệnh Node trên ThinkPad với thư mục `D:\AI-Office-Local\data\work-sessions`. Không tự chỉnh quyền NTFS/ACL, không tắt bảo mật. Code có thử lại ngắn khi Windows khóa tệp JSON trong lúc ghi; nếu quyền bị chặn từ phía công cụ thì vẫn cần phê duyệt quyền thông qua công cụ.

## Theo dõi ChatGPT Chat (riêng từng cuộc trò chuyện)

Cậu có thể thêm phiên ngay trên giao diện 3D:

1. Mở http://127.0.0.1:7788 và nhấn **+ Thêm phiên ChatGPT** ở bảng bên phải.
2. Nhập tên phiên (ví dụ ChatGPT - Báo cáo B05), chọn phòng và nhấn **Đăng ký phiên**.
3. Robot xuất hiện với trạng thái **Chưa kết nối**. Bấm **Sao chép lệnh** để lấy lệnh heartbeat với mã local đã sinh.
   - Nếu gặp **HTTP 404 khi đăng ký**: server Node hiện tại chưa nạp đúng route. Khởi động lại `D:\AI-Office-Local\scripts\start-local.ps1` rồi tải lại trang bằng Ctrl+F5. Giao diện giờ báo lỗi HTTP cụ thể thay vì `Unexpected token` khi phản hồi không phải JSON.
4. Dán lệnh đó vào cuộc trò chuyện ChatGPT muốn kết nối, yêu cầu phiên dùng công cụ Desktop Commander trên ThinkPad để chạy khi bắt đầu xử lý và báo trạng thái sau mỗi 2–3 phút. Khi hoàn thành đổi active thành done.

Mỗi phiên có một **bridgeId** riêng do localhost sinh, không phải ID hội thoại thật của ChatGPT. Mã đó có thể xem lại khi bấm vào robot. Việc mở ChatGPT tab/Recents không tự động tạo heartbeat; khi công cụ chưa có quyền chạy trên ThinkPad thì robot vẫn ở trạng thái Chưa kết nối.

    node tools/work-session.js register --kind chat --id chat-office-20261030 --name "ChatGPT · Office Assistant"
    node tools/work-session.js heartbeat --kind chat --id chat-office-20261030 --state active
    node tools/work-session.js status --kind chat --id chat-office-20261030

Đây chỉ là alias local, không phải ID thật của cuộc trò chuyện từ ChatGPT. Có thể chuyển phòng từ giao diện. Không tự đánh dấu đang làm chỉ vì người dùng mở tab. ACTIVE sẽ hết hạn sau 5 phút nếu không có heartbeat mới.

## Agent Observer – nguồn trạng thái không tốn token LLM

- Mở `http://127.0.0.1:7788/observer.html` từ menu **Agent Observer** của Văn phòng 3D.
- Agent Observer đọc GitHub **PR, Issue và Actions** bằng `gh api` **chỉ đọc** từ phiên CLI đăng nhập trên ThinkPad. Nó lấy tối đa 75 PR gần cập nhật nhất (bao gồm mở/đã merge/đóng), 100 mục từ GitHub Issues API gần cập nhật nhất (API có cả PR, Observer loại PR khỏi danh sách Issue), và 50 CI run gần đây theo chu kỳ `observerRefreshSeconds` (mặc định 120 giây). Các mục không nằm trong cửa sổ được ghi rõ chưa quan sát được. Không tạo lượt LLM; không push/merge/deploy.
- Trong `config.json` của máy (được gitignore), cấu hình `observerRepo: "OWNER/REPO"` và `observerRefreshSeconds: 120`. Để tắt GitHub observer, đặt repo rỗng. `gh auth status` phải có quyền đọc repo; không đặt token vào config.
- Hai trục được giữ độc lập: **liveness** là tín hiệu heartbeat/hook/nhật ký có mốc thời gian; **delivery** là PR, CI và trạng thái công việc tự báo. PR cập nhật hay CI chạy **không có nghĩa agent đang suy luận**.
- **Mỗi robot nhận nhiều PR và Issue:** trong card của session có hai phần **PR phụ trách** và **Issue phụ trách**; chọn một mục rồi bấm **Thêm PR/Issue**, hoặc dùng nút **Gỡ** độc lập từng liên kết. Tối đa 25 PR + 25 Issue cho mỗi phiên; một mục có thể cùng liên quan nhiều phiên nhưng không tự gán owner. Gán này do người dùng xác nhận, được lưu local trong `data/observer-links.json` và không ghi lên GitHub. Bản ghi một PR kiểu cũ được tự chuyển sang định dạng nhiều liên kết khi có thay đổi, không làm mất dữ liệu.
- **Gợi ý, không tự nhận việc:** Observer so mã task `B04`, `B05`, `D-05`, số `PR #...`, `Issue #...` từ báo cáo agent và mã branch PR đã gán để gợi ý PR/Issue mới. Để tránh phân công sai, chỉ bấm **Gán** sau khi Kyle rà và xác nhận. Gợi ý là chưa gán và không làm robot thành `ACTIVE`.
- Bảng PR hiện trạng thái CI **trong giới hạn 50 run gần đây của toàn repo**. Bảng Issue hiện trạng thái, nhãn và lần cập nhật, không suy đoán trạng thái agent. Chỉ hiển thị bằng chứng từ cửa sổ quan sát; không thay thế quality gate hay tuyên bố full CI xanh.
- Claude Code trên ThinkPad có hook ghi **metadata sự kiện** (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SessionEnd`) vào `data/observer-hooks` khi `cwd` thuộc dự án được cấu hình. Hook không lưu prompt, tool input/output, key, hoặc nội dung chat.
- Cài hook bằng `node tools/install-claude-observer-hooks.js --apply` sau khi xem dry-run. Installer **giữ nguyên** hooks cũ, sao lưu `~/.claude/settings.json`, chỉ thêm observer hooks kiểu async. Tắt bằng cách xóa riêng các hook có `observer-claude-hook.js` khỏi settings (không xóa các hook cũ). Lần cài trên ThinkPad hiện tại đã thực hiện và lưu backup.
- Các session Claude đã mở có thể cần phiên mới/đọc lại hooks để nhận sự kiện. `Codex` hiện chủ yếu được quan sát qua nhật ký local; không kết luận liveness chính xác từ log mtime hoặc giả vờ subscribe vào App Server của Codex Desktop.
- Với ChatGPT Work chạy trên cloud, Agent Observer **không scan trực tiếp suy luận trên cloud**. Giữ event-driven heartbeat khi có sự kiện thật, không tự sinh ACTIVE giả và không làm gián đoạn B04/B05 để báo trạng thái.

## Robot 3D từ file GLB của chủ văn phòng

- Đã cài local: `D:\AI-Office-Local\public\assets\ai_robot.glb`. Model được tải một lần bằng GLTFLoader rồi nhân bản cho mỗi session.
- Fallback: nếu thiếu / tải lỗi GLB, ứng dụng tự quay về robot hình khối cũ, không làm hỏng văn phòng.
- Model: **AI Robot**, tác giả **Noores** (https://sketchfab.com/nuks). Nguồn: https://sketchfab.com/3d-models/ai-robot-f7c4e4dcd1594e3e92b2d35a4ec8a93a
- Trong file GLB ghi **Sketchfab Standard**. Bản GLB chỉ lưu local và đã được gitignore, **không phát hành file model trong GitHub public fork**.
- Mỗi robot có badge trên đầu: ACTIVE, IDLE, BLOCKED, CHỜ DEV, MẤT TÍN HIỆU hoặc CHƯA KẾT NỐI. IDLE/DONE và BLOCKED cũ được phân biệt bằng chữ CŨ và mốc heartbeat; tên phiên không tự làm robot active.
- Khi setup ở máy mới, cần tự chép model được cấp quyền vào thư mục assets, hoặc để ứng dụng chạy với robot mặc định.

## Góc nhìn và cách dùng giao diện

- Mở `http://127.0.0.1:7788`: mặc định là **Văn phòng 3D** phóng lớn, không tải ba màn hình dashboard ở phía sau để giảm rối và tiết kiệm tài nguyên.
- Bảng **Đội AI · Phòng ban** bên phải: xem số phiên mỗi phòng; bấm tên phòng để camera phóng to. Bấm từng session để xem trạng thái, chọn phòng thủ công.
- Bấm **Hiện tất cả** (hoặc nút **Văn phòng** góc trái) để quay về toàn bộ các phòng.
- Bấm **Toàn cảnh** để xem lại cả ba màn hình dashboard trong không gian 3D. Các nút Công việc / Xem màn hình lớn / Nội quy vẫn mở dashboard toàn màn hình như trước.
- Các nhãn tên robot được thu gọn ở góc nhìn tổng quan để không chồng chữ; khi chọn một phòng, nhãn của các phiên trong phòng đó sẽ hiển thị đầy đủ.
- Nếu máy yếu, mở `http://127.0.0.1:7788/2d.html` để xem sơ đồ 2D.

## Nội quy AGENTS.md ưu tiên

Thứ tự đọc: `+"`"+String.raw`config.rulesFile`+"`"+String.raw` chỉ định trực tiếp → `+"`"+String.raw`AGENTS.md`+"`"+String.raw` trong thư mục dự án → `+"`"+String.raw`~/.codex/AGENTS.md`+"`"+String.raw` của người dùng → `+"`"+String.raw`CLAUDE.md`+"`"+String.raw` trong dự án → `+"`"+String.raw`data/NOI-QUY.md`+"`"+String.raw` làm nguồn dự phòng. Văn phòng chỉ đọc file, không chèn nội quy mẫu vào các repo của đội.

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
