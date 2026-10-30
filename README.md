# Văn phòng AI Local (Windows / Claude Code / Codex)

**Bản fork cho chạy tại ThinkPad:** [README-LOCAL.md](README-LOCAL.md) — bảo mật mặc định, khóa DEV nguyên tử, test/CI, Three.js chạy offline. Bản gốc: [vinaichatbot-rgb/van-phong-ao-3d](https://github.com/vinaichatbot-rgb/van-phong-ao-3d).

**Quan trọng:** chưa tự sửa AGENTS.md/CLAUDE.md của dự án Bingxue; giao diện không tự thực thi task. Nội dung phiên được ẩn và chấm điểm A/B/C/D bị tắt mặc định.

---


Biến các phiên **Claude Code** và **Codex** trên máy bạn thành một công ty AI 3D sống động, kèm đủ bộ sổ điều phối như một đội thật: việc ưu tiên, gói việc, hòm thư, lượt DEV, sổ "Cần anh", nội quy, đội ngũ, bài học, đánh giá nhân sự và tiền AI.

Mỗi phiên là một nhân viên robot có bàn riêng:
- đang làm thì gõ phím, xong việc thì báo cáo;
- phiên này nhắn phiên kia thì robot đi sang bàn người nhận;
- bạn giao việc thì cả nhóm ra phòng họp;
- ai đang giữ môi trường DEV thì đứng giữa Phòng DEV, ai đang chờ thì xếp hàng.

> **Chỉ đọc, chạy tại máy bạn.** Văn phòng chỉ đọc nhật ký mà Claude Code và Codex vốn tự ghi (`~/.claude`, `~/.codex`) và sổ của đội trong thư mục `data/`. Nó không gửi dữ liệu đi đâu và không cần khóa API. Mọi chuỗi giống khóa đều được che trước khi hiện. Server dùng Node.js chuẩn; giao diện 3D dùng Three.js được cài từ `npm ci` và phục vụ trên localhost để hoạt động offline.

---

## Cách nhanh nhất: gửi link này cho agent của bạn

Mở Claude Code hoặc Codex **trong thư mục dự án của bạn** và gõ:

> Cài văn phòng ảo cho dự án này theo hướng dẫn ở https://github.com/kevindo1103/van-phong-ai-local (đọc file HUONG-DAN-CHO-AGENT.md)

Agent sẽ tự làm các bước sau. Những bước có thay đổi bên ngoài thì nó sẽ hỏi bạn trước:

1. Kiểm tra Node.js.
2. Tải mã về.
3. Cài đặt.
4. Chạy và tự kiểm.
5. Hỏi bạn rồi mới dán luật đội vào `AGENTS.md` / `CLAUDE.md`, để mọi phiên AI tự dùng hòm thư, lượt DEV và sổ "Cần anh".
6. Điền sổ cho đúng đội thật.
7. Báo lại link cho bạn.

## Cài tay

Cần **Node.js 18+** (https://nodejs.org), cùng với **Claude Code** hoặc **Codex** đã dùng trên máy.

```bash
git clone https://github.com/kevindo1103/van-phong-ai-local.git
cd van-phong-ai-local
npm ci
npm run setup
npm start
```

Mở **http://localhost:7788**.

`npm run setup` hỏi 5 câu:
1. Theo dõi dự án nào: máy tự liệt kê các thư mục đã dùng AI trong 14 ngày, bạn gõ số thứ tự.
2. Tên văn phòng.
3. Bạn muốn được gọi là gì.
4. Có xem trên điện thoại không: trả lời có thì máy tạo khóa xem.
5. Có dán luật đội vào `AGENTS.md` / `CLAUDE.md` không.

Xong, máy ghi `config.json` và tạo sổ `data/` từ khung mẫu `mau/`.

## Các màn hình

| Màn | Có gì |
|---|---|
| **Văn phòng 3D** | 8 phòng: Giám đốc, Quản lý, Điều phối, Kiểm tra & duyệt, Studio Claude, Phòng DEV, Khu Codex, Phòng họp. Robot đi lại, tin bay giữa bàn, họp tự động. Trên cùng có ô **Cần anh** và **Tiền AI hôm nay**, kèm 3 màn hình lớn trên tường |
| **Bảng điều hành** (màn giữa) | Đang làm / chờ / bị chặn / rảnh. Phòng DEV: ai giữ, bao lâu, dịch vụ khỏe không. Việc ưu tiên, lịch DEV hôm nay, hàng chờ, luồng tin, băng chữ chạy, dải "Cần anh làm", nhịp làm việc 3 giờ |
| **Công việc & tiến độ** (màn trái) | Việc đang áp dụng theo thứ tự, nhật ký quyết định, tiến độ từng gói (mục "Đang dở"), DEV và việc chờ anh |
| **Nội quy & đội ngũ** (màn phải) | Nội quy (mục mới đổi gắn nhãn MỚI), đội ngũ (chấm xanh khi phiên đang có mặt), cấp bậc, sổ tay gồm bài học, việc để sau, từ điển, SPEC |
| **Tổng quan** | Việc gì, để làm gì, ai làm, tới đâu, nghẽn ở đâu (hạn quá thì đỏ). Từng bot đang làm gì, ai "rảnh mà còn việc", ai "im quá 2 giờ" |
| **Hòm thư** | Mỗi vai: số tin chưa xong, chờ quá 1 giờ, đọc lại từ 3 lần mà chưa xong, chưa đọc, tin cũ nhất |
| **Đánh giá nhân sự** | Token theo giờ và ngày, quỹ Codex tuần, xếp loại A/B/C/D theo việc xong, lỗi lệnh, lượt DEV, giờ làm, độ tiết kiệm |
| **Tin nhắn** | Toàn bộ tin 24 giờ, lọc theo người |
| **Sơ đồ 2D** | Bản nhẹ cho điện thoại yếu: mặt bằng, người, tin bay, cảnh báo, dòng thời gian |
| **Nhắn tin cho agent** | Bấm vào một người trên văn phòng hoặc bảng điều hành, gõ tin. Tin vào hòm thư của người đó; từ xa phải nhập **PIN 6 số**, mã chỉ hiện trên chính máy bạn |

## Sổ điều phối `data/` và công cụ `vp`

Sổ của đội nằm trong `data/`. Thư mục này đã có trong `.gitignore`, mỗi máy một bộ riêng. Agent ghi sổ bằng `node tools/vp.js …`, gõ `node tools/vp.js giup` để xem đủ lệnh:

| Sổ | Lệnh |
|---|---|
| Hòm thư `hop-thu/<vai>.jsonl` | `vp gui --toi "<vai>" "[VIỆC] …"` · `vp tiep --toi "<vai mình>"` (cuối mỗi lượt) · `vp xong <mã>` · `vp ds` |
| Lượt DEV `DEV.lock`, `DEV-LUOT.jsonl` | `vp luot cho \| lay \| nha \| huy \| xem` |
| Cần anh `CAN-ANH.md` | `vp cananh hoi \| xong \| ds` |
| Việc ưu tiên `UU-TIEN.json` | `vp viec ds \| them \| sua \| dung \| xoa` |
| Gói việc `goi/<gói>/viec.json` + `tien-do.md` | `vp goi tao \| muc \| dat \| sua \| ghichu` · `vp tiendo <gói> "…"` |
| Bài học `BAI-HOC.md` | `vp baihoc --the "<thẻ>" "…" --chan "…"` |
| Nội quy, đội ngũ, cấp bậc, việc để sau, từ điển, quyết định, SPEC | sửa tay các file `.md` trong `data/` (khung mẫu ở `mau/`) |

Luật đội để dán vào dự án nằm ở `data/DOAN-CHEN-VAO-AGENTS.md`, đã điền sẵn đường dẫn. Nó dặn mọi phiên AI 4 việc:
- đọc hòm thư cuối mỗi lượt;
- hỏi chủ qua sổ "Cần anh";
- lấy và nhả lượt DEV;
- ghi "Đang dở" trước khi nghỉ.

## Xem trên điện thoại

- **Cùng Wi-Fi:** đặt `"host": "0.0.0.0"` và `accessKey` trong `config.json`, rồi mở `http://<IP máy>:7788`.
- **Qua Internet:** cài cloudflared (Windows: `winget install --id Cloudflare.cloudflared`; macOS: `brew install cloudflared`). Chạy `powershell -ExecutionPolicy Bypass -File scripts\xem-tren-dien-thoai.ps1` hoặc `sh scripts/xem-tren-dien-thoai.sh`, mở link `trycloudflare.com` rồi nhập khóa xem một lần. Script sẽ không chạy nếu chưa có khóa xem.

## Cấu hình `config.json`

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `title`, `subtitle`, `ownerName` | Văn phòng AI, …, Giám đốc | Tên hiện trên văn phòng |
| `projects` | `[]` | Thư mục dự án cần theo dõi (tính cả thư mục con, worktree). Để trống là mọi dự án |
| `port`, `host` | 7788, 127.0.0.1 | `0.0.0.0` để máy khác trong mạng xem được |
| `accessKey` | `""` | Khóa xem: nhập một lần mới vào được |
| `keepHours` | 24 | Phiên im quá số giờ này thì rời văn phòng |
| `staff`, `hide` | `[]` | Đặt tên, chức danh, phòng (`manager`, `coord`, `g1`, `claude`, `codex`) cho phiên; giấu phiên |
| `dataDir` | `data` | Nơi để sổ điều phối |
| `rulesFile` | `""` | File nội quy riêng; để trống thì dùng `data/NOI-QUY.md`, không có thì `AGENTS.md` / `CLAUDE.md` của dự án |
| `aiCapUsd` | 100 | Trần tiền AI mỗi ngày (vượt 80% thì ô chuyển đỏ) |
| `prices` | Claude 3/0,3/15 · Codex 1,25/0,125/10 | Giá API (USD cho 1 triệu token: vào / đọc đệm / ra) để **ước tính** tiền. Dùng gói thuê bao tháng thì đây chỉ là số để so sánh |
| `dockerFilter`, `dockerStrip`, `dockerRetired` | `""`, `""`, `[]` | Hiện container Docker trong Phòng DEV, ví dụ `"name=myapp-dev"` |

## Gặp lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| `Chưa có config.json` | Chạy `npm run setup` trước. |
| Văn phòng trống | Mở phiên AI **trong đúng thư mục dự án** đã chọn; kiểm `projects` (dùng dấu `/`). |
| `EADDRINUSE` | Cổng 7788 đang bận: đổi `port`. |
| Màn 3D đen | Trình duyệt chặn WebGL hoặc chưa chạy `npm ci` hoặc trình duyệt không hỗ trợ WebGL. Thử Chrome/Edge mới, hoặc dùng Sơ đồ 2D. |
| Hòm thư không ai đọc | Phiên AI chưa có luật đội: dán `data/DOAN-CHEN-VAO-AGENTS.md` vào `AGENTS.md` / `CLAUDE.md`, và đặt tên phiên trùng tên vai. |

## Cấu trúc mã

```
server.js              máy chủ: tìm phiên, đọc nhật ký + sổ, đẩy trạng thái mỗi giây
lib/                   perf (token, điểm, tiền) · docs (sổ sách) · hopthu · tongquan · chat (PIN) · mailbox · config
tools/vp.js            công cụ ghi sổ cho agent
setup.js               cài đặt (hỏi–đáp hoặc --yes cho agent)
mau/                   khung mẫu sổ điều phối + đoạn luật đội cho AGENTS.md / CLAUDE.md
public/                giao diện: index (3D), board, congviec, noiquy, tongquan, hopthu, hieusuat, tinnhan, 2d
scripts/               mở đường hầm xem trên điện thoại
HUONG-DAN-CHO-AGENT.md hướng dẫn để agent tự cài từ link này
```

Giấy phép MIT.
