# MUSICBOX POS — chạy local bằng Rider hoặc triển khai Internet 24/7

Musicbox POS hỗ trợ quản lý phòng/box, thực đơn, đơn hàng, bếp/pha chế, thanh toán, quản trị nhân viên và đồng bộ realtime qua Socket.IO.

## Chọn cách chạy

### A. Chạy thử trên máy tính bằng JetBrains Rider

Cách này chạy máy chủ trên máy tính hiện tại. Các thiết bị khác chỉ truy cập được khi cùng mạng LAN/Wi-Fi và máy chủ trên máy tính đó vẫn đang chạy.

1. Giải nén ZIP.
2. Mở thư mục có `package.json` trong JetBrains Rider.
3. Cài Node.js 18 trở lên trên máy chạy Rider.
4. Chọn cấu hình **Musicbox POS** rồi nhấn **Run ▶**.
5. Mở `http://localhost:3000`; cửa sổ Run hiển thị thêm địa chỉ LAN nếu có.

Tài khoản dữ liệu mẫu khi chạy local lần đầu: `admin` / `123456`. Chỉ dùng dữ liệu mẫu local; khi khởi tạo cloud, mật khẩu này được thay bằng `INITIAL_ADMIN_PASSWORD` do bạn tự đặt.

### B. Chạy Internet 24/7 — đúng với nhu cầu dùng khác Wi-Fi và tắt máy Hà Nội

Để thiết bị ở Hà Nội và Yên Bái dùng chung dữ liệu ngay cả khi máy tính Hà Nội tắt, máy chủ phải chạy trên hosting Internet. Bản ZIP đã có `render.yaml` để tạo dịch vụ trên Render tại Singapore, kèm ổ lưu trữ dữ liệu bền vững.

**Không cần cài ứng dụng trên điện thoại/máy tính sử dụng POS.** Chỉ mở trình duyệt và truy cập một URL HTTPS. Tuy nhiên, người triển khai cần có tài khoản GitHub và Render (đều thao tác trên website). Đây là dịch vụ hosting bên ngoài cần thiết để giữ máy chủ chạy khi máy tính cá nhân tắt.

#### Bước 1 — Đưa mã nguồn lên GitHub bằng trình duyệt

1. Vào https://github.com và tạo repository mới ở chế độ **Private**.
2. Giải nén ZIP này trên máy tính.
3. Tải toàn bộ nội dung bên trong thư mục `musicbox-pos` lên repository (bao gồm `render.yaml`, `package.json`, `server.js`, `public/`, `scripts/` và `data/musicbox.json`). Không tải thư mục `node_modules` nếu có.
4. Trước lần triển khai đầu tiên, hãy chắc chắn `data/musicbox.json` là dữ liệu mới nhất mà bạn muốn chuyển lên máy chủ Internet. Repository nên để Private vì file dữ liệu có thể chứa thông tin vận hành cửa hàng.

#### Bước 2 — Tạo máy chủ Internet

1. Vào https://dashboard.render.com và đăng nhập/đăng ký.
2. Chọn **New → Blueprint** (hoặc tạo Blueprint mới), kết nối GitHub và chọn repository vừa tạo.
3. Render đọc cấu hình `render.yaml`. Cấu hình đã chọn Singapore, Node.js, health check `/api/health` và ổ dữ liệu `/var/data`.
4. Khi Render yêu cầu giá trị `INITIAL_ADMIN_PASSWORD`, đặt mật khẩu quản trị mới có ít nhất 12 ký tự. Không dùng `123456`.
5. Chọn xác nhận triển khai. Đợi trạng thái dịch vụ là **Live**.
6. Mở URL `https://...onrender.com` trong phần dịch vụ Render. Đăng nhập bằng tên `admin` và mật khẩu `INITIAL_ADMIN_PASSWORD` vừa đặt.

**Chi phí và chế độ chạy:** `render.yaml` dùng gói Web Service Starter và ổ đĩa 1 GB. Theo bảng giá Render hiện tại, Starter là 7 USD/tháng và ổ SSD tính 0,25 USD/GB/tháng (ước tính khoảng 7,25 USD/tháng, chưa gồm thuế/chi phí phát sinh khác). Cần gói trả phí vì Render chỉ cho gắn persistent disk vào web service trả phí; bản miễn phí có thể tự ngủ khi không có truy cập và không phù hợp yêu cầu POS cần sẵn sàng liên tục. Kiểm tra giá hiện hành tại https://render.com/pricing.

#### Bước 3 — Sử dụng ở Hà Nội, Yên Bái hoặc bất kỳ mạng nào

1. Sao chép URL `https://...onrender.com` sau khi dịch vụ Live.
2. Mở cùng URL đó trên mọi điện thoại, máy tính bảng và máy tính, dù đang dùng Wi-Fi khác nhau hoặc 4G/5G.
3. Đăng nhập bằng các tài khoản nhân viên. Khi một thiết bị thêm món, thanh toán, gửi bếp hoặc sửa dữ liệu, các thiết bị còn lại nhận cập nhật realtime.
4. Có thể tắt hoàn toàn máy tính chạy Rider ở Hà Nội. Hosting vẫn giữ website, kết nối Socket.IO và dữ liệu hoạt động.

#### Bước 4 — Cập nhật code về sau

1. Khi có lỗi hoặc cần thêm chức năng, mở dự án trong Rider và chỉnh sửa.
2. Kiểm tra tại máy local nếu cần.
3. Đẩy (push) các thay đổi lên đúng repository GitHub đã kết nối với Render.
4. Render tự build và triển khai phiên bản mới. Dữ liệu nằm trên ổ `/var/data`, vì vậy cập nhật code không ghi đè dữ liệu bán hàng đã lưu.

Không xóa ổ `musicbox-data` hoặc tạo dịch vụ mới trỏ vào ổ khác nếu không có kế hoạch sao lưu/chuyển dữ liệu. Ứng dụng hiện dùng một máy chủ và một volume để tránh nhiều bản ghi JSON độc lập.

## Dữ liệu và chuyển dữ liệu lần đầu

- Khi ổ `/var/data` còn trống ở lần chạy cloud đầu tiên, máy chủ tự sao chép `data/musicbox.json` trong repository sang ổ bền vững.
- Các lần khởi động hoặc triển khai sau đọc dữ liệu từ `/var/data/musicbox.json`, không sao chép đè dữ liệu cũ.
- Vì vậy hãy cập nhật file `data/musicbox.json` trong repository trước lần deploy đầu tiên. Sau khi cloud đã chạy, không dùng file local cũ để deploy lại hoặc ghi đè ổ cloud.
- Phiên đăng nhập hiện nằm trong RAM máy chủ; khi hosting khởi động lại hoặc triển khai bản mới, nhân viên có thể cần đăng nhập lại. Dữ liệu đơn hàng đã lưu trên ổ persistent vẫn còn.
- Nên xuất/sao lưu dữ liệu định kỳ từ môi trường vận hành và giữ bản sao riêng.

## Bảo mật

- Không công khai repository chứa `data/musicbox.json`; hãy dùng GitHub Private.
- Dùng mật khẩu quản trị mạnh tối thiểu 12 ký tự khi khởi tạo Render.
- Không gửi mật khẩu hosting hoặc mật khẩu quản trị vào repository hay mã nguồn.
- Hạn chế tạo tài khoản admin; tạo tài khoản nhân viên với quyền phù hợp.
- URL Render tự cấp HTTPS; trình duyệt dùng cùng origin cho API và Socket.IO.

## Ghi chú chức năng

- Thanh toán QR trong giao diện hiện ghi nhận phương thức thanh toán, chưa kết nối trực tiếp ngân hàng/cổng thanh toán.
- In hóa đơn sử dụng chức năng in của trình duyệt.
- Bản local vẫn chạy được trên Rider như trước; triển khai cloud là tùy chọn để bật truy cập khác mạng và độc lập với máy tính cá nhân.
