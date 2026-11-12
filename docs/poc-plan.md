# Kế hoạch PoC 5 tuần — Sandbox Kit Clone

> **Mục tiêu:** chứng minh thiết kế (`system-design.md`) chạy được thật trong 5 tuần: agent
> ghi file qua MCP, chạy build trong sandbox Docker, kết quả nhận về kho lưu, xung đột xử lý
> đúng, hệ thống tắt giữa chừng phục hồi được.
> **Giả định:** 2–3 kỹ sư toàn thời gian; chạy trên một máy chủ Docker; thử nghiệm với 2 công
> cụ MCP ngay từ tuần đầu (không đợi tuần cuối).
> **Quy tắc quản lý:** cuối mỗi tuần có demo chạy được + kiểm thử đạt; kiểm thử không đạt →
> dừng tính năng mới, sửa đến khi đạt mới sang tuần kế.

---

## 1. Bảy tiêu chí nghiệm thu (acceptance tổng)

| # | Tiêu chí | Cách kiểm |
| :--- | :--- | :--- |
| **A1** | Agent tạo phiên làm việc, ghi file qua MCP, chạy build trong sandbox, kết quả build được nhận về kho lưu | Kịch bản demo một lệnh |
| **A2** | Hai phía cùng sửa một file → phân loại đúng mọi trường hợp, chính sách xử lý đúng như thiết kế | 10 test chuẩn của thiết kế đồng bộ |
| **A3** | Tắt đột ngột hệ thống giữa chừng → khởi động lại → nhận nuôi lại sandbox còn sống, không mất trạng thái đồng bộ | Kịch bản tự động + demo |
| **A4** | Lệnh nguy hiểm bị chặn; xóa hàng loạt bị chặn | Bộ test an toàn |
| **A5** | File 50MB upload theo từng phần, lưu thành file rời, dùng được trong sandbox | Test + demo |
| **A6** | Sandbox hết hạn và sandbox mồ côi được dọn đúng — không dọn nhầm sandbox đang tạo | Bộ test tự động |
| **A7** | 9 test chuẩn chạy xanh trên cả Docker lẫn bộ giả lập | CI local |

---

## 2. Trong / ngoài phạm vi PoC

**Trong:** Docker + bộ giả lập · trình thực thi gRPC · đồng bộ hai chiều + xung đột + dấu xóa ·
ghi sổ thao tác · dọn dẹp + phục hồi · bộ chặn lệnh + chặn xóa hàng loạt · hạn mức dung lượng ·
upload theo phần + file rời · bộ tool MCP cốt lõi · kết quả lệnh gửi dần.

**Ngoài:** Kubernetes (mở rộng tuần 5 nếu đủ sức) · lưu trữ đám mây · dashboard · phân quyền
đầy đủ · Git đầy đủ (chỉ mức cơ bản nếu đủ sức) · tối ưu hiệu năng.

---

## 3. Kiến trúc triển khai PoC

- **Một tiến trình Python** chứa 4 thành phần trong hệ: cửa vào MCP, bộ điều phối, bộ đồng.
  bộ, kho file — quy tắc "mỗi database một người ghi" thỏa tự nhiên.
- **Trình thực thi:** chương trình Python chạy làm khởi đầu của container sandbox; image =.
  python-slim + bộ công cụ (git, node, python) + trình thực thi. Đóng gói lại image tối đa
  một lần mỗi tuần.
- **Nơi chứa mã dự án:** volume Docker riêng mỗi sandbox, sao chép mã vào ngay khi tạo.
  (kế thừa đúng bản gốc).
- **Cấu hình:** qua file env — các ngưỡng (file lớn ~3MB, file rời 32MB), hạn mức 2GB, chế.
  độ bộ chặn lệnh, công tắc tắt các bộ dọn dẹp.

---

## 4. Lịch chi tiết theo tuần

### Tuần 1 — Nền tảng: kho file + MCP + bộ giả lập

Đầu việc:
1. Dựng khung repo + kiểm thử tự động + cấu hình + script tiện ích.
2. Database dự án + database hệ thống đúng thiết kế + script khởi tạo.
3. Kho file lõi: ghi/đọc/xóa (để lại dấu xóa)/sửa khớp mờ; lịch sử có giới hạn; bỏ qua thư.
   viện phụ thuộc 3 tầng; kiểm tra đường dẫn một chỗ.
4. Khung MCP: kết nối HTTP + tạo dự án + bộ tool file.
5. Bộ khung Provider + bộ giả lập (chạy test không cần Docker)
6. Upload theo phần + file rời cho file ≥32MB + hạn mức dung lượng.

**Bàn giao:** agent ghi/đọc file hoàn toàn qua MCP; file 50MB đi đường upload riêng vào file
rời; bộ giả lập cho gọi được mọi tool từ đầu.
**Gate:** test kho file xanh; 2 công cụ MCP (Inspector + Claude Code) đều chạy được.

### Tuần 2 — Docker + trình thực thi + chạy lệnh

Đầu việc:
1. Provider Docker: tạo/xóa/tạm dừng/gia hạn + volume chứa mã + địa chỉ kết nối + dọn volume.
2. Trình thực thi bên trong sandbox: chạy lệnh (kết quả gửi theo dòng), nhận file (xác nhận.
   từng file), báo danh sách file, gửi/nhận file lớn.
3. Bộ điều phối: gọi đồng bộ trước mỗi lệnh — tuần này gửi trọn bộ, hoàn thiện "chỉ phần.
   thay đổi" ở tuần 3.
4. `command_run` + giới hạn thời gian + kết quả gửi dần + chuẩn hóa kết quả trả về.
5. Bộ chặn lệnh 2 lớp (chế độ cảnh báo)

**Bàn giao:** agent chạy build thật trong sandbox; kết quả hiện dần theo thời gian thực; bộ
chặn nhận diện được lệnh phá hoại.
**Gate:** test "ghi file qua MCP → file xuất hiện trong sandbox → lệnh đọc được" xanh.

### Tuần 3 — Đồng bộ hai chiều + xung đột

Đầu việc:
1. Hoàn thiện bộ đồng bộ: tính phần thay đổi theo mốc; gửi + xác nhận từng file đúng trình tự.
   hai bước ghi.
2. Nhận về: so 10 trường hợp chuẩn → ghi vào kho qua kho file.
3. Dấu xóa + dọn dẹp + không làm đôi khi chạy lại.
4. Chính sách xung đột ("sandbox thắng" / "báo lỗi") + cảnh báo + chặn xóa hàng loạt.
5. Từ chối chạy lệnh khi đồng bộ chưa xong; đồng bộ trượt tự sửa ở lệnh kế.
6. 10 test chuẩn + test tình huống lỗi (mất mạng giữa chừng, tắt hệ thống giữa hai bước ghi)

**Bàn giao:** hai kịch bản then chốt chạy đúng — kết quả build nhận về kho; agent sửa file
trong lúc lệnh chạy → xung đột được phân loại và xử lý đúng chính sách.
**Gate:** A2 + A7 xanh.

### Tuần 4 — Tự chữa lỗi + an toàn

Đầu việc:
1. Dọn dẹp theo thời hạn (sandbox tạm dừng không bị dọn) + quét mồ côi (không dọn nhầm.
   sandbox đang tạo, có công tắc tắt)
2. Phục hồi khi khởi động lại: đọc sổ → hỏi thăm từng sandbox → nhận nuôi / dọn sạch.
3. Ghi sổ thao tác + chạy lại an toàn toàn hệ thống.
4. Hạn mức dung lượng với file thật lớn — từ chối rõ ràng.
5. Chế độ chặn hẳn + test chặn xóa hàng loạt + ghi vết ba lớp.
6. (Nếu còn giờ) cache dùng chung theo dự án cho npm/pip.

**Bàn giao:** A3 + A4 + A6 xanh; demo tắt đột ngột giữa chừng không mất dữ liệu.
**Gate:** kịch bản xáo trộn (tắt hệ thống ngẫu nhiên giữa các bước đồng bộ/chạy lệnh) — trạng
thái luôn khôi phục, không sót rác.

### Tuần 5 — Tích hợp + demo + mở rộng

Đầu việc:
1. Kịch bản demo trọn vẹn (A1): tạo dự án → nạp/ghi mã → chạy build → nhận kết quả về kho →.
   kịch bản xung đột → tắt đột ngột hệ thống → phục hồi → tiếp tục làm việc bình thường.
2. Làm mạch báo lỗi chuẩn hóa toàn bộ tool + cập nhật tài liệu API.
3. Mở rộng (chọn một theo sức): Kubernetes tối thiểu HOẶC Git cơ bản (clone/commit/push)
4. Chốt tài liệu: cập nhật `system-design.md` theo thực tế build + bảng lệch kế hoạch.

**Bàn giao:** demo chạy trực tiếp trước nhóm + báo cáo PoC (kết quả so với A1–A7, bài học,
đề xuất giai đoạn sau).
**Gate:** A1–A7 xanh (trừ mục mở rộng).

---

## 5. Phân công (3 kỹ sư)

| Vai | Phạm vi |
| :--- | :--- |
| **E1 — Cửa vào MCP** | Giao thức MCP + bộ tool, upload theo phần, xác thực, bộ chặn lệnh, báo lỗi chuẩn |
| **E2 — Hạ tầng chạy** | Provider Docker (+K8s mở rộng), trình thực thi gRPC, vòng đời/dọn dẹp/phục hồi, image sandbox |
| **E3 — Kho file & đồng bộ** | Cấu trúc database, kho file lõi, bộ đồng bộ + xung đột + dấu xóa, sổ thao tác, hạn mức |

*(2 kỹ sư: E1+E3 gộp — chấp nhận trễ ~1 tuần ở tuần 3–4 hoặc cắt mục mở rộng.)*

---

## 6. Rủi ro & cách giảm thiểu

| Rủi ro | Ảnh hưởng | Cách giảm thiểu |
| :--- | :--- | :--- |
| Đóng gói trình thực thi vào image chậm/cồng kềnh | Tuần 2 trễ | Chạy thử ngoài container trước; image tối giản; đóng gói lại tối đa 1 lần/tuần |
| Repo quá lớn làm việc quét file chậm | Nhận về chậm | Nhớ trạng thái từng file — chỉ tính dấu vân tay cho file thay đổi |
| File lớn làm database chậm | Mọi thao tác chậm | File ≥32MB thành file rời ngay từ tuần 1; đo sớm |
| Các công cụ MCP hành xử khác nhau | Demo gãy | Thử 2 công cụ ngay từ tuần 1, không đợi tuần 5 |
| Chính sách xung đột khiến agent khó chịu | Trải nghiệm | Dùng chế độ cảnh báo trong PoC; thông báo rõ ràng trong câu trả lời |
| 5 tuần chật với 2 người | Phạm vi | Mục mở rộng cắt trước; A1–A7 là mức tối thiểu phải đạt |
| Khác biệt môi trường Docker/gVisor | Tuần 2 bất ổn | PoC cố định một máy chủ; Kubernetes chỉ là mục mở rộng |

---

## 7. Nhịp vận hành

- Demo + chấm gate vào thứ sáu hằng tuần; gate đỏ = dừng tính năng mới, sửa gate trước.
- 10 test chuẩn của thiết kế đồng bộ là **hợp đồng** — thay đổi quy trình phải đi qua test.
- Mọi quyết định lệch `system-design.md` phải ghi lại vào tài liệu trong tuần đó.
