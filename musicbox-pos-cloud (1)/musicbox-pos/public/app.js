'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const localDateKey = value => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const timeAgo = date => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
};

const state = {
  token: localStorage.getItem('musicbox_token') || '',
  user: null,
  snapshot: null,
  socket: null,
  connected: false,
  selectedRoomId: null,
  view: 'rooms',
  mobileTab: 'rooms',
  roomFilter: 'all',
  category: 'Tất cả',
  search: '',
  autoMenu: localStorage.getItem('musicbox_auto_menu') !== 'false',
  drawerOpen: false,
  adminSection: 'management',
  modalType: null,
  paymentMethod: 'cash',
  toastTimer: null
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new Error('Không thể kết nối máy chủ. Hãy kiểm tra kết nối Internet rồi thử lại.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) forceLogout('Phiên đăng nhập đã hết hạn.');
    throw new Error(data.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
  }
  return data;
}

async function loadNetworkAccess() {
  const target = $('#networkAccess');
  if (!target) return;
  try {
    const response = await fetch('/api/network-info', { cache: 'no-store' });
    if (!response.ok) throw new Error('Không lấy được địa chỉ truy cập.');
    const info = await response.json();
    target.replaceChildren();

    const heading = document.createElement('strong');
    const note = $('#loginNote');
    const demoAccount = $('#demoAccount');

    if (info.hosted && info.publicUrl) {
      heading.textContent = 'Địa chỉ truy cập từ mọi nơi:';
      target.appendChild(heading);
      const link = document.createElement('a');
      link.href = info.publicUrl;
      link.textContent = info.publicUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      target.appendChild(link);
      const explanation = document.createElement('span');
      explanation.textContent = ' Máy chủ đang chạy trên Internet. Điện thoại/máy tính ở Hà Nội, Yên Bái hoặc mạng 4G đều dùng cùng địa chỉ này.';
      target.appendChild(explanation);
      if (note) note.textContent = 'Đăng nhập bằng tài khoản cửa hàng. Dữ liệu được đồng bộ trực tiếp qua Internet, không phụ thuộc máy tính ở cửa hàng đang bật hay tắt.';
      if (demoAccount) demoAccount.classList.add('hidden');
      return;
    }

    heading.textContent = 'Địa chỉ dùng cho thiết bị khác cùng Wi-Fi:';
    target.appendChild(heading);
    if (demoAccount) demoAccount.classList.remove('hidden');
    const addresses = Array.isArray(info.addresses) ? info.addresses : [];
    if (!addresses.length) {
      const message = document.createElement('span');
      message.textContent = ' Chưa tìm thấy địa chỉ LAN. Hãy kiểm tra Wi-Fi của máy chủ.';
      target.appendChild(message);
      return;
    }

    for (const item of addresses) {
      const link = document.createElement('a');
      link.href = item.url;
      link.textContent = item.url;
      link.title = `Mạng ${item.interfaceName || 'nội bộ'}`;
      target.appendChild(link);
    }
  } catch {
    target.textContent = 'Không thể đọc địa chỉ truy cập. Hãy kiểm tra kết nối máy chủ.';
  }
}

function setConnection(connected) {
  state.connected = connected;
  const indicator = $('#syncIndicator');
  if (indicator) {
    indicator.classList.toggle('offline', !connected);
    $('span', indicator).textContent = connected ? 'Đã đồng bộ trực tiếp' : 'Mất kết nối';
  }
  const footerText = $('#footerSyncText');
  if (footerText) footerText.textContent = connected ? 'Đã đồng bộ trực tiếp' : 'Đang kết nối lại...';
}

function connectSocket() {
  if (!state.token || typeof window.io !== 'function') return;
  if (state.socket) state.socket.disconnect();
  const socket = window.io({ auth: { token: state.token }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000 });
  state.socket = socket;
  socket.on('connect', async () => {
    setConnection(true);
    try {
      const result = await api('/api/bootstrap');
      state.user = result.user;
      state.snapshot = result.state;
      renderApp();
    } catch (error) { showToast(error.message, 'error'); }
  });
  socket.on('disconnect', () => setConnection(false));
  socket.on('connect_error', () => setConnection(false));
  socket.on('state:update', payload => {
    if (payload && payload.state) {
      state.snapshot = payload.state;
      renderApp();
    }
  });
  socket.on('notification:new', payload => {
    if (payload?.state) state.snapshot = payload.state;
    const ticket = payload?.notification;
    $('#notificationBtn')?.classList.remove('pulse');
    void $('#notificationBtn')?.offsetWidth;
    $('#notificationBtn')?.classList.add('pulse');
    showToast(`🔔 ${ticket?.roomName || 'Đơn hàng'} vừa gửi thông báo tới Bếp / Pha chế`, 'success');
    renderApp();
  });
  socket.on('kitchen:update', payload => {
    if (payload?.state) state.snapshot = payload.state;
    renderApp();
  });
}

function showToast(message, type = 'success', detail = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${escapeHtml(message)}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}`;
  $('#toastRegion').appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

function currentOrder() { return state.snapshot?.activeOrders?.[state.selectedRoomId] || null; }
function currentRoom() { return state.snapshot?.rooms?.find(room => room.id === state.selectedRoomId) || null; }
function allActiveOrders() { return Object.values(state.snapshot?.activeOrders || {}); }
function activeRooms() { return (state.snapshot?.rooms || []).filter(room => room.active !== false); }
function countItems(order) { return (order?.items || []).reduce((total, item) => total + Number(item.qty || 0), 0); }
function totalOf(order) { return (order?.items || []).reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 0), 0); }

function showLogin() {
  $('#loginView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
  setConnection(false);
}

function showApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#currentUserName').textContent = state.user?.displayName || state.user?.username || 'Nhân viên';
  $('#drawerUserName').textContent = state.user?.displayName || state.user?.username || 'Nhân viên';
  $('#drawerUserRole').textContent = state.user?.role === 'admin' ? 'Administrator' : 'Nhân viên';
  $('#drawerAvatar').textContent = (state.user?.displayName || 'M').trim().charAt(0).toUpperCase();
  $('#autoMenuCheck').checked = state.autoMenu;
  renderApp();
  connectSocket();
}

function forceLogout(message = '') {
  if (state.socket) state.socket.disconnect();
  state.token = '';
  state.user = null;
  state.snapshot = null;
  localStorage.removeItem('musicbox_token');
  if (message) $('#loginError').textContent = message;
  showLogin();
}

async function login(event) {
  event.preventDefault();
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  $('#loginError').textContent = '';
  const button = $('.login-submit');
  button.disabled = true;
  button.innerHTML = 'Đang đăng nhập...';
  try {
    const result = await api('/api/login', { method: 'POST', body: { username, password } });
    state.token = result.token;
    state.user = result.user;
    state.snapshot = result.state;
    localStorage.setItem('musicbox_token', state.token);
    state.selectedRoomId = Object.keys(state.snapshot.activeOrders || {})[0] || null;
    showApp();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Đăng nhập hệ thống <span>→</span>';
  }
}

function renderApp() {
  if (!state.snapshot || !state.user) return;
  if (state.selectedRoomId && !state.snapshot.rooms.some(r => r.id === state.selectedRoomId)) state.selectedRoomId = null;
  $('#footerStoreName').textContent = state.snapshot.settings?.storeName || 'Musicbox';
  $('#footerBranch').textContent = state.snapshot.settings?.branchName || 'Cơ sở chính';
  $('#workspace').dataset.mobileTab = state.mobileTab;
  $$('.main-tab').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  $$('.mobile-nav-item').forEach(button => button.classList.toggle('active', button.dataset.mobile === state.mobileTab));
  renderCatalog();
  renderOrder();
  renderBadges();
  if (state.drawerOpen) renderAdminSection();
}

function setView(view) {
  state.view = view === 'menu' ? 'menu' : 'rooms';
  state.mobileTab = state.view;
  renderApp();
}

function setMobileTab(tab) {
  state.mobileTab = tab;
  if (tab === 'rooms' || tab === 'menu') state.view = tab;
  renderApp();
}

function roomOrder(room) { return state.snapshot.activeOrders[room.id] || null; }

function renderCatalog() {
  const isMenu = state.view === 'menu';
  $('#catalogKicker').textContent = isMenu ? 'DANH SÁCH SẢN PHẨM' : 'QUẢN LÝ KHÔNG GIAN';
  $('#catalogTitle').textContent = isMenu ? 'Thực đơn / Giờ hát' : 'Phòng / Box';
  $('#roomFilters').classList.toggle('hidden', isMenu);
  $('#catalogContext').classList.toggle('hidden', isMenu);
  $('#categoryStrip').classList.toggle('hidden', !isMenu);
  $('#roomsGrid').classList.toggle('hidden', isMenu);
  $('#productsGrid').classList.toggle('hidden', !isMenu);
  $('#autoMenuCheck').parentElement.classList.toggle('hidden', isMenu);
  $('#addOrderBtn').classList.toggle('hidden', isMenu);
  if (isMenu) renderProducts(); else renderRooms();
}

function renderRooms() {
  const rooms = activeRooms();
  const inUseCount = rooms.filter(room => Boolean(roomOrder(room))).length;
  $('#roomSummary').textContent = `${rooms.length} phòng / box · ${inUseCount} đang sử dụng`;
  $$('#roomFilters button').forEach(button => button.classList.toggle('selected', button.dataset.filter === state.roomFilter));
  const filtered = rooms.filter(room => {
    const order = roomOrder(room);
    if (state.roomFilter === 'in-use' && !order) return false;
    if (state.roomFilter === 'available' && order) return false;
    const query = state.search.trim().toLowerCase();
    return !query || room.name.toLowerCase().includes(query);
  });
  $('#roomsGrid').innerHTML = filtered.map(room => {
    const order = roomOrder(room);
    const used = Boolean(order);
    const amount = totalOf(order);
    const elapsed = order ? timeAgo(order.startedAt) : '';
    const guest = order?.guests || room.capacity;
    const progress = used ? Math.min(100, Math.max(8, (Date.now() - new Date(order.startedAt).getTime()) / 3600000 * 100)) : 0;
    return `<button class="room-card ${used ? 'in-use' : ''} ${state.selectedRoomId === room.id ? 'selected' : ''}" data-action="select-room" data-id="${escapeHtml(room.id)}">
      <div class="room-card-top"><span class="room-icon">${room.type === 'takeaway' ? '⌁' : '▦'}</span><span class="room-state">${used ? '● Đang sử dụng' : '○ Còn trống'}</span></div>
      <h3>${escapeHtml(room.name)}</h3><div class="room-amount">${used ? money(amount) : (room.type === 'takeaway' ? 'Đơn mang về' : `${room.capacity || '—'} chỗ ngồi`)}</div>
      <div class="room-extra"><span>${used ? `◷ ${elapsed}` : (room.type === 'takeaway' ? 'Nhận đơn tại quầy' : 'Sẵn sàng phục vụ')}</span><b>${used ? `♙ ${order.guests || 1}` : ''}</b></div>
      ${used ? `<div class="room-progress" style="--progress:${progress}%"></div>` : ''}
    </button>`;
  }).join('') || `<div class="empty-admin">Không tìm thấy phòng phù hợp.</div>`;
}

const categories = ['Tất cả', 'Giờ hát', 'Đồ ăn', 'Nước uống', 'Combo'];
function productEmoji(category) { return ({ 'Giờ hát': '♫', 'Đồ ăn': '🍟', 'Nước uống': '🥤', 'Combo': '🎉' })[category] || '✦'; }
function renderProducts() {
  $('#categoryStrip').innerHTML = categories.map(category => `<button class="category-chip ${state.category === category ? 'active' : ''}" data-action="category" data-category="${category}">${category}</button>`).join('');
  const query = state.search.trim().toLowerCase();
  const products = (state.snapshot.products || []).filter(product => product.active !== false && (state.category === 'Tất cả' || product.category === state.category) && (!query || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query)));
  $('#productsGrid').innerHTML = products.map(product => `<button class="product-card" data-action="add-product" data-id="${escapeHtml(product.id)}">
    <span class="product-art">${productEmoji(product.category)}</span><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><p class="product-desc">${escapeHtml(product.description || product.unit || '')}</p>
    <span class="product-card-bottom"><b class="product-price">${money(product.price)}</b><span class="add-product">＋</span></span>
  </button>`).join('') || `<div class="empty-admin">Không tìm thấy sản phẩm. Thử từ khóa khác hoặc chọn danh mục khác.</div>`;
}

function renderOrder() {
  const orders = allActiveOrders().sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  $('#orderTabs').innerHTML = orders.map(order => {
    const room = state.snapshot.rooms.find(row => row.id === order.roomId);
    return `<button class="order-tab ${order.roomId === state.selectedRoomId ? 'active' : ''}" data-action="select-order" data-id="${escapeHtml(order.roomId)}">${escapeHtml(room?.name || 'Đơn')} <span>${countItems(order)}</span></button>`;
  }).join('') || `<span style="font-size:9px;color:#b2a1ad;padding-left:4px">Chưa có đơn đang mở</span>`;
  const room = currentRoom();
  const order = currentOrder();
  $('#orderRoomTitle').textContent = room?.name || 'Chưa chọn phòng';
  $('#orderStatus').classList.toggle('active', Boolean(order));
  $('#orderStatus').innerHTML = `<i></i> ${order ? `Đang phục vụ · ${timeAgo(order.startedAt)}` : 'Chưa mở đơn'}`;
  const customer = $('#customerInput');
  if (document.activeElement !== customer) customer.value = order?.customer || '';
  $('#customerInput').disabled = !order;
  $('#addCustomerBtn').disabled = !order;
  $('#staffSelect').disabled = !order;
  $('#guestSelect').disabled = !order;
  $('#orderNoteInput').disabled = !order;
  if (document.activeElement !== $('#orderNoteInput')) $('#orderNoteInput').value = order?.notes || '';
  const staffOptions = [...new Set([...(state.snapshot.users || []).filter(user => user.active !== false).map(user => user.displayName || user.username), order?.assignedStaff].filter(Boolean))];
  $('#staffSelect').innerHTML = staffOptions.map(name => `<option ${name === order?.assignedStaff ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('') || '<option>Chưa phân công</option>';
  $('#guestSelect').value = String(order?.guests || 2);
  if (!order || !order.items.length) {
    $('#orderItems').innerHTML = `<div class="empty-order"><div class="empty-order-icon">♫</div><b>${order ? 'Chưa có món trong đơn' : 'Chưa có đơn hàng'}</b><p>${order ? 'Vui lòng chọn món ăn trong menu bên trái màn hình' : 'Chọn một phòng / box để bắt đầu order.'}</p></div>`;
  } else {
    $('#orderItems').innerHTML = order.items.map(item => `<div class="order-item" data-item="${escapeHtml(item.id)}">
      <div class="order-item-main"><b>${escapeHtml(item.name)}</b><small>${money(item.price)} ${item.unit ? `/ ${escapeHtml(item.unit)}` : ''}</small><input class="item-note" data-id="${escapeHtml(item.id)}" placeholder="Ghi chú món..." value="${escapeHtml(item.note || '')}" aria-label="Ghi chú ${escapeHtml(item.name)}" /></div>
      <div class="qty-control"><button data-action="qty-minus" data-id="${escapeHtml(item.id)}" aria-label="Giảm số lượng">−</button><b>${item.qty}</b><button data-action="qty-plus" data-id="${escapeHtml(item.id)}" aria-label="Tăng số lượng">＋</button></div>
      <div class="item-price">${money(item.price * item.qty)}<button data-action="remove-item" data-id="${escapeHtml(item.id)}" title="Xóa món">×</button></div>
    </div>`).join('');
  }
  const total = totalOf(order);
  $('#subtotalText').textContent = money(total);
  $('#totalText').textContent = money(total);
  $('#payButtonTotal').textContent = money(total);
  $('#mobileTotal').textContent = money(total);
  const itemCount = countItems(order);
  $('#mobileCartCount').textContent = itemCount;
  $('#mobileCartCount').classList.toggle('hidden', itemCount === 0);
  $('#mobilePaybar').classList.toggle('hidden', state.mobileTab !== 'orders' || !isMobile());
  $('#notifyBtn').disabled = !order || !itemCount;
  $('#payBtn').disabled = !order || !itemCount;
  $('#mobilePayBtn').disabled = !order || !itemCount;
  $('#addTabBtn').disabled = !activeRooms().some(r => !roomOrder(r));
}

function isMobile() { return window.matchMedia('(max-width: 850px)').matches; }

function renderBadges() {
  const count = (state.snapshot.kitchenTickets || []).filter(ticket => ticket.status === 'new').length;
  $('#notificationCount').textContent = count;
  $('#notificationCount').classList.toggle('hidden', !count);
  $('#kitchenBadge').textContent = count;
  $('#kitchenBadge').classList.toggle('hidden', !count);
}

async function openRoom(roomId) {
  try {
    const room = state.snapshot.rooms.find(row => row.id === roomId);
    if (!room) return;
    await api(`/api/rooms/${encodeURIComponent(roomId)}/open`, { method: 'POST', body: { guests: Math.min(room.capacity || 2, 2) || 2 } });
    state.selectedRoomId = roomId;
    if (state.autoMenu) setView('menu'); else { state.view = 'rooms'; state.mobileTab = isMobile() ? 'orders' : 'rooms'; renderApp(); }
    if (isMobile()) state.mobileTab = state.autoMenu ? 'menu' : 'orders';
    renderApp();
  } catch (error) { showToast(error.message, 'error'); }
}

async function addProduct(productId) {
  if (!state.selectedRoomId || !currentOrder()) {
    showToast('Vui lòng chọn phòng / box trước khi thêm món.', 'error');
    setView('rooms');
    return;
  }
  try {
    await api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}/items`, { method: 'POST', body: { productId, qty: 1 } });
    if (isMobile()) state.mobileTab = 'orders';
    renderApp();
  } catch (error) { showToast(error.message, 'error'); }
}

async function updateItem(itemId, changes) {
  if (!state.selectedRoomId) return;
  try { await api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: changes }); }
  catch (error) { showToast(error.message, 'error'); }
}

async function notifyKitchen() {
  if (!state.selectedRoomId) return;
  try {
    const result = await api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}/notify`, { method: 'POST', body: {} });
    state.snapshot = result.state;
    renderApp();
    showToast('Đã gửi thông báo tới Bếp / Pha chế và các thiết bị.', 'success', 'Phiếu gọi món đã được cập nhật trực tiếp.');
  } catch (error) { showToast(error.message, 'error'); }
}

function openPaymentModal() {
  const order = currentOrder();
  if (!order || !order.items.length) return showToast('Đơn hàng chưa có món để thanh toán.', 'error');
  state.paymentMethod = 'cash';
  renderPaymentModal();
}

function renderPaymentModal() {
  const order = currentOrder();
  const total = totalOf(order);
  $('#modalBackdrop').classList.remove('hidden');
  $('#modalContent').innerHTML = `<div class="modal-title-row"><h3>Thanh toán đơn hàng</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <p class="modal-copy">${escapeHtml(currentRoom()?.name || 'Đơn hàng')} · ${countItems(order)} sản phẩm · Chọn phương thức thanh toán</p>
    <div class="payment-methods">
      <button class="payment-option ${state.paymentMethod === 'cash' ? 'active' : ''}" data-action="payment-method" data-method="cash"><span>💵</span>Tiền mặt</button>
      <button class="payment-option ${state.paymentMethod === 'bank' ? 'active' : ''}" data-action="payment-method" data-method="bank"><span>🏦</span>Chuyển khoản</button>
      <button class="payment-option ${state.paymentMethod === 'qr' ? 'active' : ''}" data-action="payment-method" data-method="qr"><span>▦</span>Mã QR</button>
    </div>
    ${state.paymentMethod === 'qr' ? `<div class="qr-placeholder"><div class="qr-grid"><span>MB</span></div><b>QR thanh toán Musicbox</b><br/>Đây là mã minh họa giao diện. Vui lòng xác nhận giao dịch thực tế trước khi hoàn tất.</div>` : ''}
    <div class="payment-total"><span>Tổng cần thanh toán</span><b>${money(total)}</b></div>
    <div class="form-actions"><button class="secondary-btn" data-action="close-modal">Quay lại</button><button class="mini-primary" data-action="confirm-payment">Xác nhận thanh toán</button></div>`;
}

async function confirmPayment() {
  try {
    const result = await api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}/pay`, { method: 'POST', body: { method: state.paymentMethod } });
    state.snapshot = result.state;
    const receipt = result.receipt;
    state.selectedRoomId = Object.keys(state.snapshot.activeOrders || {})[0] || null;
    $('#modalContent').innerHTML = `<div class="modal-title-row"><h3>Thanh toán thành công</h3><span style="color:#16a36a;font-size:20px">✓</span></div>
      <p class="modal-copy">Hóa đơn <b>${escapeHtml(receipt.number)}</b> đã được lưu. Phòng đã được giải phóng trên tất cả thiết bị.</p>
      <div class="payment-total"><span>Khách đã thanh toán</span><b>${money(receipt.total)}</b></div>
      <p class="modal-copy">Phương thức: ${receipt.method === 'cash' ? 'Tiền mặt' : receipt.method === 'bank' ? 'Chuyển khoản' : 'Mã QR'}</p>
      <div class="form-actions"><button class="secondary-btn" data-action="close-modal">Đóng</button><button class="mini-primary" data-action="print-receipt" data-id="${escapeHtml(receipt.id)}">In hóa đơn</button></div>`;
    renderApp();
    showToast('Thanh toán thành công · Đã cập nhật các thiết bị.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

function printReceipt(receipt) {
  if (!receipt) return;
  const settings = state.snapshot.settings || {};
  const popup = window.open('', '_blank', 'width=420,height=720');
  if (!popup) return showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.', 'error');
  const rows = receipt.items.map(item => `<tr><td>${escapeHtml(item.name)}<br><small>${item.qty} × ${money(item.price)}</small></td><td style="text-align:right">${money(item.qty * item.price)}</td></tr>`).join('');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Hóa đơn ${escapeHtml(receipt.number)}</title><style>body{font:13px Arial,sans-serif;width:300px;margin:20px auto;color:#222}h2{text-align:center;margin-bottom:4px}p{text-align:center;margin:4px 0;color:#555;font-size:11px}.line{border-top:1px dashed #aaa;margin:12px 0}table{width:100%;border-collapse:collapse}td{padding:7px 0;vertical-align:top;font-size:12px}small{color:#777}.total{font-size:18px;font-weight:bold;text-align:right;margin:12px 0}.thanks{text-align:center;margin-top:22px}</style></head><body><h2>${escapeHtml(settings.storeName || 'Musicbox')}</h2><p>${escapeHtml(settings.branchName || '')}</p><p>${escapeHtml(settings.address || '')}</p><div class="line"></div><p style="text-align:left">Hóa đơn: ${escapeHtml(receipt.number)}<br>Thời gian: ${new Date(receipt.paidAt).toLocaleString('vi-VN')}<br>Phòng: ${escapeHtml(receipt.roomName)}<br>Thu ngân: ${escapeHtml(receipt.cashier)}</p><div class="line"></div><table>${rows}</table><div class="line"></div><div class="total">Tổng: ${money(receipt.total)}</div><p>Thanh toán: ${receipt.method === 'cash' ? 'Tiền mặt' : receipt.method === 'bank' ? 'Chuyển khoản' : 'QR'}</p><p class="thanks">Cảm ơn quý khách và hẹn gặp lại! ♫</p><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`);
  popup.document.close();
}

function openDrawer(section = 'management') {
  state.drawerOpen = true;
  state.adminSection = section;
  $('#drawerBackdrop').classList.remove('hidden');
  $('#adminDrawer').classList.add('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'false');
  renderAdminSection();
}
function closeDrawer() {
  state.drawerOpen = false;
  $('#drawerBackdrop').classList.add('hidden');
  $('#adminDrawer').classList.remove('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'true');
}
function setAdminSection(section) {
  state.adminSection = section;
  $$('#drawerNav button[data-admin]').forEach(button => button.classList.toggle('active', button.dataset.admin === section));
  renderAdminSection();
}

function renderAdminSection() {
  if (!state.snapshot) return;
  $$('#drawerNav button[data-admin]').forEach(button => button.classList.toggle('active', button.dataset.admin === state.adminSection));
  const target = $('#drawerContent');
  const rooms = activeRooms();
  const products = state.snapshot.products.filter(product => product.active !== false);
  const users = state.snapshot.users || [];
  const tickets = state.snapshot.kitchenTickets || [];
  const receipts = state.snapshot.receipts || [];
  const section = state.adminSection;
  if (section === 'management') {
    target.innerHTML = `<h3>Quản lý cửa hàng</h3><p class="subcopy">Thiết lập các dữ liệu vận hành của Musicbox.</p><div class="manage-grid">
      <button class="manage-card" data-action="admin-sub" data-section="rooms"><span class="manage-icon">▦</span><b>Phòng / Box</b><small>${rooms.length} khu vực · Thêm, sửa và sắp xếp</small></button>
      <button class="manage-card" data-action="admin-sub" data-section="products"><span class="manage-icon">♫</span><b>Món ăn & Giờ hát</b><small>${products.length} sản phẩm · Giá và danh mục</small></button>
      <button class="manage-card" data-action="admin-sub" data-section="users"><span class="manage-icon">♙</span><b>Tài khoản nhân viên</b><small>${users.length} tài khoản đang lưu</small></button>
      <button class="manage-card" data-action="admin-sub" data-section="prices"><span class="manage-icon">◇</span><b>Bảng giá dịch vụ</b><small>Thiết lập giá giờ hát và phụ thu</small></button>
    </div>`;
  } else if (section === 'rooms') {
    target.innerHTML = `<div class="admin-section-head"><div><h3>Phòng / Box</h3><p class="subcopy">Quản lý danh sách khu vực phục vụ.</p></div><button class="mini-primary" data-action="add-room">＋ Thêm phòng</button></div>
      <table class="admin-table"><thead><tr><th>TÊN PHÒNG</th><th>SỨC CHỨA</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${rooms.map(room => `<tr><td><strong>${escapeHtml(room.name)}</strong></td><td>${room.capacity || '—'} khách</td><td><span class="status-chip ${roomOrder(room) ? '' : 'green'}">${roomOrder(room) ? 'Đang sử dụng' : 'Còn trống'}</span></td><td><div class="table-actions"><button data-action="edit-room" data-id="${escapeHtml(room.id)}">Sửa</button><button class="danger" data-action="delete-room" data-id="${escapeHtml(room.id)}">Xóa</button></div></td></tr>`).join('')}</tbody></table>`;
  } else if (section === 'products' || section === 'prices') {
    const shown = section === 'prices' ? products.filter(product => product.category === 'Giờ hát') : products;
    target.innerHTML = `<div class="admin-section-head"><div><h3>${section === 'prices' ? 'Thiết lập bảng giá' : 'Món ăn & Giờ hát'}</h3><p class="subcopy">${section === 'prices' ? 'Cập nhật giá các gói hát và phụ thu.' : 'Thêm sản phẩm, chỉnh sửa giá và danh mục.'}</p></div><button class="mini-primary" data-action="add-product">＋ Thêm món</button></div>
      <table class="admin-table"><thead><tr><th>TÊN SẢN PHẨM</th><th>DANH MỤC</th><th>GIÁ BÁN</th><th>THAO TÁC</th></tr></thead><tbody>${shown.map(product => `<tr><td><strong>${escapeHtml(product.name)}</strong><br><small>${escapeHtml(product.unit || '')}</small></td><td>${escapeHtml(product.category)}</td><td><strong>${money(product.price)}</strong></td><td><div class="table-actions"><button data-action="edit-product" data-id="${escapeHtml(product.id)}">Sửa</button><button class="danger" data-action="delete-product" data-id="${escapeHtml(product.id)}">Ẩn</button></div></td></tr>`).join('')}</tbody></table>`;
  } else if (section === 'users') {
    target.innerHTML = `<div class="admin-section-head"><div><h3>Tài khoản nhân viên</h3><p class="subcopy">Mỗi nhân viên có thể đăng nhập trên một thiết bị riêng.</p></div><button class="mini-primary" data-action="add-user">＋ Tạo tài khoản</button></div>
      <table class="admin-table"><thead><tr><th>NHÂN VIÊN</th><th>TÀI KHOẢN</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${users.map(user => `<tr><td><strong>${escapeHtml(user.displayName)}</strong></td><td>${escapeHtml(user.username)}</td><td>${user.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</td><td><span class="status-chip ${user.active === false ? 'amber' : 'green'}">${user.active === false ? 'Đã khóa' : 'Hoạt động'}</span></td><td><button class="secondary-btn" data-action="edit-user" data-id="${escapeHtml(user.id)}">Sửa</button></td></tr>`).join('')}</tbody></table>`;
  } else if (section === 'kitchen') {
    const pending = tickets.filter(ticket => ticket.status !== 'done');
    target.innerHTML = `<div class="admin-section-head"><div><h3>Bếp / Pha chế</h3><p class="subcopy">Phiếu gọi món mới từ tất cả thiết bị · cập nhật trực tiếp.</p></div><span class="status-chip">${pending.length} phiếu đang xử lý</span></div>
      ${tickets.length ? tickets.map(ticket => `<div class="ticket-card"><div class="ticket-top"><b>${escapeHtml(ticket.roomName)} <span style="color:#b59aa9;font-weight:500">· ${new Date(ticket.createdAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</span></b><span class="status-chip ${ticket.status === 'done' ? 'green' : ticket.status === 'preparing' ? 'amber' : ''}">${ticket.status === 'done' ? 'Hoàn tất' : ticket.status === 'preparing' ? 'Đang làm' : 'Mới'}</span></div><p>${ticket.items.map(item => `${escapeHtml(item.name)} × ${item.qty}${item.note ? ` (${escapeHtml(item.note)})` : ''}`).join('<br>')}${ticket.notes ? `<br><i>Ghi chú: ${escapeHtml(ticket.notes)}</i>` : ''}</p><div class="ticket-bottom"><small>${escapeHtml(ticket.createdBy || '')}</small><div class="table-actions">${ticket.status === 'new' ? `<button data-action="ticket-status" data-id="${escapeHtml(ticket.id)}" data-status="preparing">Bắt đầu</button>` : ''}${ticket.status !== 'done' ? `<button data-action="ticket-status" data-id="${escapeHtml(ticket.id)}" data-status="done">Hoàn tất ✓</button>` : ''}</div></div></div>`).join('') : `<div class="empty-admin">Chưa có phiếu gọi món.<br/>Khi nhân viên bấm “Thông báo (F10)”, đơn hàng sẽ xuất hiện tại đây.</div>`}`;
  } else if (section === 'secondary') {
    target.innerHTML = `<h3>Màn hình phụ</h3><p class="subcopy">Chế độ hiển thị đơn hàng gọn cho màn hình đặt tại quầy hoặc khu vực phục vụ.</p><div class="stat-grid"><div class="stat-card"><small>Đơn đang mở</small><b>${allActiveOrders().length}</b></div><div class="stat-card"><small>Phiếu bếp mới</small><b>${tickets.filter(t => t.status === 'new').length}</b></div><div class="stat-card"><small>Phòng đang dùng</small><b>${rooms.filter(room => roomOrder(room)).length}</b></div></div><h3 style="font-size:13px;margin-bottom:10px">Đơn hàng đang phục vụ</h3>${allActiveOrders().length ? allActiveOrders().map(order => `<div class="ticket-card"><div class="ticket-top"><b>${escapeHtml(state.snapshot.rooms.find(r => r.id === order.roomId)?.name || 'Đơn hàng')}</b><b style="color:var(--pink-dark)">${money(totalOf(order))}</b></div><p>${order.items.length ? order.items.map(item => `${escapeHtml(item.name)} × ${item.qty}`).join('<br>') : 'Chưa có món'}</p><div class="ticket-bottom"><small>${timeAgo(order.startedAt)} · ${countItems(order)} sản phẩm</small></div></div>`).join('') : `<div class="empty-admin">Không có đơn hàng đang mở.</div>`}`;
  } else if (section === 'reports') {
    const today = localDateKey(new Date());
    const todayReceipts = receipts.filter(receipt => localDateKey(receipt.paidAt) === today && receipt.status === 'paid');
    const revenue = todayReceipts.reduce((sum, receipt) => sum + receipt.total, 0);
    target.innerHTML = `<h3>Báo cáo cuối ngày</h3><p class="subcopy">Số liệu được tổng hợp từ các hóa đơn đã thanh toán · ${new Date().toLocaleDateString('vi-VN')}.</p><div class="stat-grid"><div class="stat-card"><small>Doanh thu thực tế</small><b>${money(revenue)}</b></div><div class="stat-card"><small>Số hóa đơn</small><b>${todayReceipts.length}</b></div><div class="stat-card"><small>Giá trị trung bình</small><b>${money(todayReceipts.length ? revenue / todayReceipts.length : 0)}</b></div></div><h3 style="font-size:13px;margin-bottom:10px">Hóa đơn hôm nay</h3>${todayReceipts.length ? `<table class="admin-table"><thead><tr><th>MÃ HÓA ĐƠN</th><th>PHÒNG</th><th>THANH TOÁN</th><th>TỔNG TIỀN</th></tr></thead><tbody>${todayReceipts.map(r => `<tr><td><strong>${escapeHtml(r.number)}</strong></td><td>${escapeHtml(r.roomName)}</td><td>${r.method === 'cash' ? 'Tiền mặt' : r.method === 'bank' ? 'Chuyển khoản' : 'QR'}</td><td><strong>${money(r.total)}</strong></td></tr>`).join('')}</tbody></table>` : `<div class="empty-admin">Chưa có hóa đơn thanh toán trong ngày.</div>`}`;
  } else if (section === 'cash') {
    target.innerHTML = `<h3>Lập phiếu thu / chi</h3><p class="subcopy">Ghi nhận các khoản thu, chi phát sinh ngoài hóa đơn bán hàng.</p><form id="cashForm" class="admin-form"><div class="form-field"><label>Loại phiếu</label><select name="type"><option value="income">Phiếu thu</option><option value="expense">Phiếu chi</option></select></div><div class="form-field"><label>Số tiền (₫)</label><input name="amount" type="number" min="1" required placeholder="Ví dụ: 500000" /></div><div class="form-field full"><label>Lý do / Nội dung</label><input name="reason" required placeholder="Nhập nội dung thu hoặc chi" /></div><div class="form-actions"><button class="mini-primary" type="submit">Lưu phiếu</button></div></form><h3 style="font-size:13px;margin:24px 0 9px">Lịch sử thu / chi</h3><table class="admin-table"><thead><tr><th>LOẠI</th><th>NỘI DUNG</th><th>SỐ TIỀN</th><th>THỜI GIAN</th></tr></thead><tbody>${(state.snapshot.cashRecords || []).map(record => `<tr><td><span class="status-chip ${record.type === 'income' ? 'green' : 'amber'}">${record.type === 'income' ? 'Thu' : 'Chi'}</span></td><td>${escapeHtml(record.reason)}</td><td><strong>${money(record.amount)}</strong></td><td>${new Date(record.createdAt).toLocaleDateString('vi-VN')}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có phiếu thu / chi.</td></tr>'}</tbody></table>`;
  } else if (section === 'returns') {
    const eligible = receipts.filter(receipt => receipt.status === 'paid');
    target.innerHTML = `<h3>Chọn đơn trả hàng</h3><p class="subcopy">Chọn hóa đơn đã thanh toán để ghi nhận yêu cầu trả hàng. Hệ thống sẽ đánh dấu hóa đơn đã trả.</p><form id="returnForm" class="admin-form"><div class="form-field full"><label>Hóa đơn</label><select name="receiptId" required>${eligible.map(receipt => `<option value="${escapeHtml(receipt.id)}">${escapeHtml(receipt.number)} · ${escapeHtml(receipt.roomName)} · ${money(receipt.total)}</option>`).join('') || '<option value="">Không có hóa đơn hợp lệ</option>'}</select></div><div class="form-field full"><label>Lý do trả hàng</label><input name="reason" placeholder="Nhập lý do" /></div><div class="form-actions"><button class="mini-primary" type="submit" ${eligible.length ? '' : 'disabled'}>Xác nhận trả hàng</button></div></form><h3 style="font-size:13px;margin:24px 0 9px">Lịch sử trả hàng</h3><table class="admin-table"><thead><tr><th>HÓA ĐƠN</th><th>LÝ DO</th><th>SỐ TIỀN</th></tr></thead><tbody>${(state.snapshot.returnRecords || []).map(row => `<tr><td>${escapeHtml(row.receiptNumber)}</td><td>${escapeHtml(row.reason)}</td><td>${money(row.amount)}</td></tr>`).join('') || '<tr><td colspan="3">Chưa có giao dịch trả hàng.</td></tr>'}</tbody></table>`;
  } else if (section === 'settings') {
    const settings = state.snapshot.settings || {};
    target.innerHTML = `<h3>Cài đặt chung</h3><p class="subcopy">Thông tin hiển thị ở chân trang và trên hóa đơn Musicbox.</p><form id="settingsForm" class="admin-form"><div class="form-field"><label>Tên cửa hàng</label><input name="storeName" value="${escapeHtml(settings.storeName || '')}" required /></div><div class="form-field"><label>Tên cơ sở</label><input name="branchName" value="${escapeHtml(settings.branchName || '')}" /></div><div class="form-field full"><label>Địa chỉ</label><input name="address" value="${escapeHtml(settings.address || '')}" /></div><div class="form-field full"><label>Số điện thoại</label><input name="phone" value="${escapeHtml(settings.phone || '')}" /></div><div class="form-actions"><button class="mini-primary" type="submit">Lưu cài đặt</button></div></form>`;
  } else if (section === 'presets') {
    const presets = products.filter(product => ['Giờ hát', 'Combo'].includes(product.category));
    target.innerHTML = `<h3>Món có sẵn trong đơn</h3><p class="subcopy">Các gói dịch vụ thường dùng có thể được thêm nhanh từ danh mục Thực đơn / Giờ hát.</p><div class="empty-admin" style="margin-bottom:13px">Chọn phòng đang phục vụ, mở Thực đơn và chạm vào sản phẩm để thêm vào đơn. Thao tác được đồng bộ tức thì đến các thiết bị khác.</div>${presets.map(product => `<div class="ticket-card"><div class="ticket-top"><b>${escapeHtml(product.name)}</b><b style="color:var(--pink-dark)">${money(product.price)}</b></div><p>${escapeHtml(product.description || product.category)}</p></div>`).join('')}`;
  } else if (section === 'shift') {
    target.innerHTML = `<h3>Đổi nguồn / Ca làm việc</h3><p class="subcopy">Ghi lại thời điểm bàn giao ca hoặc chuyển nhân viên phụ trách tại cửa hàng.</p><form id="shiftForm" class="admin-form"><div class="form-field full"><label>Ghi chú bàn giao</label><textarea name="note" placeholder="Ví dụ: Bàn giao ca tối, tiền quỹ đã kiểm đếm..."></textarea></div><div class="form-actions"><button class="mini-primary" type="submit">Xác nhận đổi ca</button></div></form><h3 style="font-size:13px;margin:24px 0 9px">Lịch sử ca làm việc</h3>${(state.snapshot.shiftLogs || []).map(log => `<div class="ticket-card"><div class="ticket-top"><b>${escapeHtml(log.user)}</b><small>${new Date(log.createdAt).toLocaleString('vi-VN')}</small></div><p>${escapeHtml(log.note || log.action)}</p></div>`).join('') || `<div class="empty-admin">Chưa có lịch sử đổi ca.</div>`}`;
  }
}

function openModal(html) {
  $('#modalBackdrop').classList.remove('hidden');
  $('#modalContent').innerHTML = html;
}
function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  $('#modalContent').innerHTML = '';
}

function openEntityModal(type, id = null) {
  const isEdit = Boolean(id);
  let entity = null;
  if (type === 'room') entity = state.snapshot.rooms.find(row => row.id === id);
  if (type === 'product') entity = state.snapshot.products.find(row => row.id === id);
  if (type === 'user') entity = state.snapshot.users.find(row => row.id === id);
  let title = type === 'room' ? (isEdit ? 'Chỉnh sửa phòng / Box' : 'Thêm phòng / Box') : type === 'product' ? (isEdit ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm') : (isEdit ? 'Cập nhật tài khoản' : 'Tạo tài khoản nhân viên');
  let fields = '';
  if (type === 'room') fields = `<div class="form-field full"><label>Tên phòng / Box</label><input name="name" required value="${escapeHtml(entity?.name || '')}" placeholder="Ví dụ: Box 7" /></div><div class="form-field"><label>Loại</label><select name="type"><option value="box" ${entity?.type !== 'takeaway' ? 'selected' : ''}>Phòng / Box</option><option value="takeaway" ${entity?.type === 'takeaway' ? 'selected' : ''}>Mang về</option></select></div><div class="form-field"><label>Sức chứa</label><input name="capacity" type="number" min="0" value="${entity?.capacity ?? 6}" /></div>`;
  if (type === 'product') fields = `<div class="form-field full"><label>Tên món / gói hát</label><input name="name" required value="${escapeHtml(entity?.name || '')}" /></div><div class="form-field"><label>Danh mục</label><select name="category">${categories.filter(c => c !== 'Tất cả').map(c => `<option ${entity?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div class="form-field"><label>Giá bán (₫)</label><input name="price" type="number" min="0" required value="${entity?.price ?? ''}" /></div><div class="form-field"><label>Đơn vị tính</label><input name="unit" value="${escapeHtml(entity?.unit || 'món')}" /></div><div class="form-field"><label>Mô tả</label><input name="description" value="${escapeHtml(entity?.description || '')}" /></div>`;
  if (type === 'user') fields = `<div class="form-field"><label>Họ tên hiển thị</label><input name="displayName" required value="${escapeHtml(entity?.displayName || '')}" /></div><div class="form-field"><label>Tên đăng nhập</label><input name="username" ${isEdit ? 'disabled' : 'required'} value="${escapeHtml(entity?.username || '')}" /></div><div class="form-field"><label>${isEdit ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu (ít nhất 6 ký tự)'}</label><input name="password" type="password" ${isEdit ? '' : 'required'} minlength="6" /></div><div class="form-field"><label>Vai trò</label><select name="role"><option value="staff" ${entity?.role !== 'admin' ? 'selected' : ''}>Nhân viên</option><option value="admin" ${entity?.role === 'admin' ? 'selected' : ''}>Quản trị viên</option></select></div>${isEdit ? `<div class="form-field full"><label>Trạng thái</label><select name="active"><option value="true" ${entity?.active !== false ? 'selected' : ''}>Hoạt động</option><option value="false" ${entity?.active === false ? 'selected' : ''}>Đã khóa</option></select></div>` : ''}`;
  openModal(`<div class="modal-title-row"><h3>${title}</h3><button class="modal-close" data-action="close-modal">×</button></div><p class="modal-copy">Thông tin được lưu trên máy chủ và đồng bộ tới các thiết bị đã đăng nhập.</p><form class="modal-form" id="entityForm" data-type="${type}" data-id="${escapeHtml(id || '')}" data-edit="${isEdit}"><div class="admin-form">${fields}<div class="form-actions"><button type="button" class="secondary-btn" data-action="close-modal">Hủy</button><button type="submit" class="mini-primary">${isEdit ? 'Lưu thay đổi' : 'Tạo mới'}</button></div></div></form>`);
}

async function submitEntityForm(form) {
  const type = form.dataset.type;
  const id = form.dataset.id;
  const edit = form.dataset.edit === 'true';
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (type === 'room') {
      if (edit) await api(`/api/admin/rooms/${encodeURIComponent(id)}`, { method: 'PUT', body: { name: data.name, type: data.type, capacity: Number(data.capacity), active: true } });
      else await api('/api/admin/rooms', { method: 'POST', body: { ...data, capacity: Number(data.capacity) } });
    } else if (type === 'product') {
      data.price = Number(data.price);
      if (edit) await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
      else await api('/api/admin/products', { method: 'POST', body: data });
    } else if (type === 'user') {
      if (edit) {
        const body = { displayName: data.displayName, role: data.role, active: data.active === 'true' };
        if (data.password) body.password = data.password;
        await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body });
      } else await api('/api/admin/users', { method: 'POST', body: data });
    }
    closeModal();
    const latest = await api('/api/bootstrap');
    state.snapshot = latest.state;
    renderApp();
    showToast('Đã lưu thay đổi thành công.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

async function deleteEntity(type, id) {
  const messages = { room: 'Xóa phòng / Box này?', product: 'Ẩn sản phẩm này khỏi thực đơn?' };
  if (!window.confirm(messages[type] || 'Bạn chắc chắn muốn thực hiện?')) return;
  try {
    const url = type === 'room' ? `/api/admin/rooms/${encodeURIComponent(id)}` : `/api/admin/products/${encodeURIComponent(id)}`;
    await api(url, { method: 'DELETE' });
    const latest = await api('/api/bootstrap');
    state.snapshot = latest.state;
    renderApp();
    showToast('Đã cập nhật danh sách.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

async function submitDrawerForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === 'cashForm') await api('/api/admin/cash', { method: 'POST', body: { ...data, amount: Number(data.amount) } });
    if (form.id === 'returnForm') await api('/api/admin/returns', { method: 'POST', body: data });
    if (form.id === 'settingsForm') await api('/api/admin/settings', { method: 'PUT', body: data });
    if (form.id === 'shiftForm') await api('/api/admin/shift', { method: 'POST', body: data });
    const latest = await api('/api/bootstrap');
    state.snapshot = latest.state;
    renderApp();
    showToast('Đã lưu thông tin.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

async function changeTicketStatus(ticketId, status) {
  try { await api(`/api/kitchen/${encodeURIComponent(ticketId)}/status`, { method: 'POST', body: { status } }); showToast('Đã cập nhật trạng thái phiếu bếp.', 'success'); }
  catch (error) { showToast(error.message, 'error'); }
}

function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'select-room') return openRoom(id);
  if (action === 'select-order') { state.selectedRoomId = id; if (isMobile()) state.mobileTab = 'orders'; renderApp(); return; }
  if (action === 'category') { state.category = button.dataset.category; renderProducts(); return; }
  if (action === 'add-product') return id ? addProduct(id) : openEntityModal('product');
  if (action === 'qty-plus' || action === 'qty-minus') {
    const item = currentOrder()?.items.find(row => row.id === id);
    if (item) updateItem(id, { qty: item.qty + (action === 'qty-plus' ? 1 : -1) });
    return;
  }
  if (action === 'remove-item') return updateItem(id, { qty: 0 });
  if (action === 'admin-sub') return setAdminSection(button.dataset.section);
  if (action === 'add-room') return openEntityModal('room');
  if (action === 'edit-room') return openEntityModal('room', id);
  if (action === 'delete-room') return deleteEntity('room', id);
  if (action === 'edit-product') return openEntityModal('product', id);
  if (action === 'delete-product') return deleteEntity('product', id);
  if (action === 'add-user') return openEntityModal('user');
  if (action === 'edit-user') return openEntityModal('user', id);
  if (action === 'ticket-status') return changeTicketStatus(id, button.dataset.status);
  if (action === 'close-modal') return closeModal();
  if (action === 'payment-method') { state.paymentMethod = button.dataset.method; return renderPaymentModal(); }
  if (action === 'confirm-payment') return confirmPayment();
  if (action === 'print-receipt') { const receipt = state.snapshot.receipts.find(row => row.id === id); closeModal(); return printReceipt(receipt); }
}

async function logout() {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* token may have expired */ }
  if (state.socket) state.socket.disconnect();
  localStorage.removeItem('musicbox_token');
  state.token = ''; state.user = null; state.snapshot = null; state.selectedRoomId = null;
  closeDrawer(); closeModal(); showLogin();
}

// Login and global controls.
$('#loginForm').addEventListener('submit', login);
$('#fillDemo').addEventListener('click', () => { $('#loginUsername').value = 'admin'; $('#loginPassword').value = '123456'; $('#loginPassword').focus(); });
$('#togglePassword').addEventListener('click', () => { const input = $('#loginPassword'); input.type = input.type === 'password' ? 'text' : 'password'; });
$$('.main-tab').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('.mobile-nav-item').forEach(button => button.addEventListener('click', () => setMobileTab(button.dataset.mobile)));
$('#globalSearch').addEventListener('input', event => {
  state.search = event.target.value;
  if (state.search.trim()) { state.view = 'menu'; if (isMobile()) state.mobileTab = 'menu'; }
  renderApp();
});
$('#roomFilters').addEventListener('click', event => { const button = event.target.closest('button[data-filter]'); if (!button) return; state.roomFilter = button.dataset.filter; renderRooms(); });
$('#autoMenuCheck').addEventListener('change', event => { state.autoMenu = event.target.checked; localStorage.setItem('musicbox_auto_menu', String(state.autoMenu)); });
$('#addOrderBtn').addEventListener('click', () => { const room = activeRooms().find(row => !roomOrder(row)); if (room) openRoom(room.id); else showToast('Tất cả phòng đang có đơn. Hãy thanh toán hoặc chọn phòng đang mở.', 'error'); });
$('#addTabBtn').addEventListener('click', () => { const room = activeRooms().find(row => !roomOrder(row)); if (room) openRoom(room.id); else showToast('Không còn phòng trống để mở đơn mới.', 'error'); });
$('#notifyBtn').addEventListener('click', notifyKitchen);
$('#payBtn').addEventListener('click', openPaymentModal);
$('#mobilePayBtn').addEventListener('click', openPaymentModal);
$('#adminTrigger').addEventListener('click', () => openDrawer('management'));
$('#notificationBtn').addEventListener('click', () => openDrawer('kitchen'));
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);
$('#drawerNav').addEventListener('click', event => { const button = event.target.closest('button[data-admin]'); if (button) setAdminSection(button.dataset.admin); });
$('#logoutBtn').addEventListener('click', logout);
$('#refreshBtn').addEventListener('click', async () => { try { const result = await api('/api/bootstrap'); state.snapshot = result.state; state.user = result.user; renderApp(); showToast('Dữ liệu đã được làm mới.', 'success'); } catch (error) { showToast(error.message, 'error'); } });
$('#printBtn').addEventListener('click', () => { const order = currentOrder(); if (!order) return showToast('Chọn đơn hàng để in tạm tính.', 'error'); window.print(); });
$('#customerInput').addEventListener('blur', event => { if (currentOrder() && event.target.value !== currentOrder().customer) api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}`, { method: 'PATCH', body: { customer: event.target.value } }).catch(error => showToast(error.message, 'error')); });
$('#addCustomerBtn').addEventListener('click', () => $('#customerInput').focus());
$('#staffSelect').addEventListener('change', event => { if (currentOrder()) api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}`, { method: 'PATCH', body: { assignedStaff: event.target.value } }).catch(error => showToast(error.message, 'error')); });
$('#guestSelect').addEventListener('change', event => { if (currentOrder()) api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}`, { method: 'PATCH', body: { guests: Number(event.target.value) } }).catch(error => showToast(error.message, 'error')); });
$('#orderNoteInput').addEventListener('blur', event => { if (currentOrder() && event.target.value !== currentOrder().notes) api(`/api/orders/${encodeURIComponent(state.selectedRoomId)}`, { method: 'PATCH', body: { notes: event.target.value } }).catch(error => showToast(error.message, 'error')); });
$('#orderItems').addEventListener('change', event => { const input = event.target.closest('.item-note'); if (input) updateItem(input.dataset.id, { note: input.value }); });
$('#orderItems').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.classList.contains('item-note')) event.target.blur(); });
$('#drawerContent').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
$('#drawerContent').addEventListener('submit', event => { if (event.target.matches('#cashForm,#returnForm,#settingsForm,#shiftForm')) { event.preventDefault(); submitDrawerForm(event.target); } });
$('#modalContent').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
$('#modalContent').addEventListener('submit', event => { if (event.target.id === 'entityForm') { event.preventDefault(); submitEntityForm(event.target); } });
$('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
$('#roomsGrid').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
$('#productsGrid').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
$('#categoryStrip').addEventListener('click', event => { const button = event.target.closest('button[data-action="category"]'); if (button) handleAction(button); });
$('#orderTabs').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
$('#orderItems').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeModal(); closeDrawer(); }
  if (event.key === 'F3') { event.preventDefault(); $('#globalSearch').focus(); }
  if (event.key === 'F4') { event.preventDefault(); if (currentOrder()) $('#customerInput').focus(); }
  if (event.key === 'F9') { event.preventDefault(); openPaymentModal(); }
  if (event.key === 'F10') { event.preventDefault(); notifyKitchen(); }
});
window.addEventListener('resize', () => renderOrder());
setInterval(() => { if (state.snapshot && state.user) { if (state.view === 'rooms') renderRooms(); const order = currentOrder(); if (order) $('#orderStatus').innerHTML = `<i></i> Đang phục vụ · ${timeAgo(order.startedAt)}`; } }, 30000);

async function initialize() {
  if (!state.token) return showLogin();
  try {
    const result = await api('/api/bootstrap');
    state.user = result.user;
    state.snapshot = result.state;
    state.selectedRoomId = Object.keys(state.snapshot.activeOrders || {})[0] || null;
    showApp();
  } catch {
    localStorage.removeItem('musicbox_token');
    state.token = '';
    showLogin();
  }
}

loadNetworkAccess();
initialize();
