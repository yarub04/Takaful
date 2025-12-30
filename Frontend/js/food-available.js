import { getAllAvailableFood, searchFood, getFoodByHotelIdAndStatus } from '../api/claude_api/food_api.js';
import { reserveFood as apiReserveFood, getOrdersByCharityIdAndStatus, markAsPickedUp as apiMarkAsPickedUp } from '../api/claude_api/order_api.js';
import { isLoggedIn, getCurrentUser } from '../api/claude_api/auth_api.js';
import { getCharityByUserId } from '../api/claude_api/charity_api.js';
import { isCharityUser, isHotelUser } from './role-guard.js';
import { getHotelByUserId } from '../api/claude_api/hotel_api.js';




let foodItems = [];
let allItems = [];

// --- 1. Mapping Functions ---

// تحويل استجابة الطعام (FoodResponse) إلى شكل البطاقة
function mapFoodResponseToUiItem(fr) {
    function isPastDateTime(v) {
  if (!v) return false;
  // يدعم "YYYY-MM-DDTHH:mm:ss" أو مع .SSS
  const d = new Date(String(v).replace(' ', 'T'));
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

    const status = (fr.status || '').toString().toUpperCase();
    let uiStatus = 'available';
    if (status === 'RESERVED') uiStatus = 'reserved';
    if (status === 'COMPLETED' || status === 'PICKED_UP') uiStatus = 'delivered';
    if (status === 'EXPIRED' || status === 'CANCELLED') uiStatus = 'expired';
    
    const until = fr.availableUntil ? new Date(fr.availableUntil) : null;
    const expiredByDate = isPastDateTime(fr.availableUntil) || isPastDateTime(fr.pickupTime);
    if (expiredByDate) uiStatus = 'expired';
    return {
        id: fr.id,
        name: fr.title || 'بدون عنوان',
        type: fr.type || (
  status === 'AVAILABLE' ? 'متاح' :
  status === 'RESERVED' ? 'محجوز' :
  status === 'EXPIRED' ? 'منتهي' :
  (status === 'COMPLETED' || status === 'PICKED_UP') ? 'تم التوزيع' :
  (status === 'CANCELLED') ? 'ملغي' :
  (status ? status : '—')
),
        quantity: (fr.quantity != null) ? `${fr.quantity} وجبة` : 'غير محدد',
        location: fr.hotelAddress || 'غير محدد',
        restaurant: fr.hotelName || '—',
        restaurantPhone: fr.hotelPhone || '',
        expiry: until ? until.toLocaleString('ar-JO') : 'غير محدد',
        status: uiStatus,
        timeLeft: until ? computeTimeLeft(until) : '',
        reservedBy: fr.charityName || ''
    };
}
function normalizeOrderStatus(orderStatus) {
  const s = (orderStatus || '').toUpperCase();

  if (s === 'CONFIRMED' || s === 'PENDING') return 'reserved';
  if (s === 'PICKED_UP') return 'delivered';
  if (s === 'CANCELLED') return 'expired';

  // fallback
  return 'reserved';
}

// تحويل استجابة الطلب (OrderResponse) إلى شكل البطاقة (للجمعيات)
function mapOrderResponseToUiItem(order) {
    // نفترض أن OrderResponse يحتوي على كائن food بداخله
    // إذا كان الهيكل مختلفاً، يجب تعديل هذا الجزء
    const food = order.food || {};

    // ✅ fallback من order إذا food ناقص
    const title = food.title || order.foodTitle || order.title || '';
    const quantityVal = (food.quantity != null ? food.quantity : (order.foodQuantity != null ? order.foodQuantity : null));
    const hotelName = food.hotelName || order.hotelName || order.restaurantName || '';
    const hotelAddress = food.hotelAddress || order.hotelAddress || order.address || '';
    const hotelPhone = food.hotelPhone || order.hotelPhone || order.contactPhone || '';

    const availableUntilRaw =
        food.availableUntil ||
        order.availableUntil ||
        order.foodAvailableUntil ||
        food.pickupTime ||
        order.pickupTime ||
        order.foodPickupTime ||
        null;


    const until = availableUntilRaw ? new Date(String(availableUntilRaw).replace(' ', 'T')) : null;
    
    // حالة الطلب للواجهة
    const orderStatus = (order.status || '').toUpperCase();
    let uiStatus = 'reserved';
    if (orderStatus === 'PICKED_UP') uiStatus = 'delivered';
    if (orderStatus === 'CANCELLED') uiStatus = 'expired';
    if (until && until.getTime() < Date.now()) uiStatus = 'expired';

    const orderTypeArabic =
      orderStatus === 'CONFIRMED' ? 'محجوز' :
      orderStatus === 'PICKED_UP' ? 'تم التوزيع' :
      orderStatus === 'CANCELLED' ? 'ملغي' :
      'طلب';

    return {
        id: food.id || order.foodId || order.id,   // مهم: للعمليات
        orderId: order.id,
        name: title || 'طلب بدون عنوان',
        type: food.type || orderTypeArabic,
        quantity: (quantityVal != null) ? `${quantityVal} وجبة` : 'غير محدد',
        location: hotelAddress || 'غير محدد',
        restaurant: hotelName || '—',
        restaurantPhone: hotelPhone || '',
        expiry: until ? until.toLocaleString('ar-JO') : 'غير محدد',
        status: uiStatus,
        timeLeft: until ? computeTimeLeft(until) : '',
        reservedBy: 'جمعيتكم'
    };

    
}


function computeTimeLeft(untilDate) {
    const now = new Date();
    const diffMs = untilDate - now;
    if (diffMs <= 0) return 'انتهت';
    const diffMin = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    if (hours <= 0) return `ينتهي خلال ${mins} دقيقة`;
    return `ينتهي خلال ${hours} ساعة و ${mins} دقيقة`;
}

// --- 2. Main Loading Logic ---

async function safeCall(promiseFn, fallback = []) {
    try {
        const r = await promiseFn();
        return Array.isArray(r) ? r : fallback;
    } catch (e) {
        return fallback;
    }
}

function applyFilter(filter) {
    const f = (filter || 'all').toLowerCase();

    if (f === 'all') foodItems = [...allItems];
    else foodItems = allItems.filter(x => (x.status || '').toLowerCase() === f);

    updateFilterCounts();
    renderFoodCards();
}

async function loadFoods({ keyword, filterStatus } = {}) {
    const foodList = document.getElementById('foodList');
    if (foodList) foodList.innerHTML = '<p style="text-align:center; padding: 20px;">جاري تحميل البيانات...</p>';

    const user = getCurrentUser();
    const activeBtn = document.querySelector('.filter-btn.active');
    const currentFilter = filterStatus || (activeBtn ? activeBtn.dataset.filter : 'all');

    try {
        allItems = [];

        // ✅ حالة البحث: خليها بس تعرض نتائج البحث (غالبًا متاح)
        if (keyword) {
            const foods = await searchFood(keyword);
            allItems = (Array.isArray(foods) ? foods : []).map(mapFoodResponseToUiItem);
            applyFilter(currentFilter);
            return;
        }

        // ✅ غير مسجل: عرض المتاح فقط
        if (!isLoggedIn()) {
            const foods = await getAllAvailableFood();
            allItems = (Array.isArray(foods) ? foods : []).map(mapFoodResponseToUiItem);
            applyFilter(currentFilter);
            return;
        }

        // ✅ HOTEL / RESTAURANT: اعرض كل الحالات الخاصة فيه
        if (isHotel(user)) {
            const hotel = await getHotelByUserId(user.id); // مهم: user.id مش hotelId
            const hotelId = hotel?.id;

            if (!hotelId) {
                allItems = [];
                applyFilter(currentFilter);
                return;
            }

            const [
                availableFoods,
                reservedFoods,
                completedFoods,
                expiredFoods,
                cancelledFoods
            ] = await Promise.all([
                safeCall(() => getFoodByHotelIdAndStatus(hotelId, 'AVAILABLE')),
                safeCall(() => getFoodByHotelIdAndStatus(hotelId, 'RESERVED')),
                safeCall(() => getFoodByHotelIdAndStatus(hotelId, 'COMPLETED')),
                safeCall(() => getFoodByHotelIdAndStatus(hotelId, 'EXPIRED')),
                safeCall(() => getFoodByHotelIdAndStatus(hotelId, 'CANCELLED')),
            ]);

            const merged = [
                ...availableFoods,
                ...reservedFoods,
                ...completedFoods,
                ...expiredFoods,
                ...cancelledFoods
            ];

            allItems = merged.map(mapFoodResponseToUiItem);
            applyFilter(currentFilter);
            return;
        }

        // ✅ CHARITY: (1) متاح للتصفح + (2) طلبات محجوز + (3) طلبات تم التوزيع + (4) ملغي/منتهي إن وجد
        if (isCharity(user)) {
            const charity = await getCharityByUserId(user.id);
            const charityId = charity?.id;

            const availableFoods = await safeCall(() => getAllAvailableFood());
            const reservedFoods  = await safeCall(() => getAllFoodByStatus('RESERVED'));
            const completedFoods = await safeCall(() => getAllFoodByStatus('COMPLETED'));
            const expiredFoods   = await safeCall(() => getAllFoodByStatus('EXPIRED'));
            const cancelledFoods = await safeCall(() => getAllFoodByStatus('CANCELLED'));

            const pendingOrders   = charityId ? await safeCall(() => getOrdersByCharityIdAndStatus(charityId, 'CONFIRMED')) : [];
            const completedOrders = []; // ما في COMPLETED بالباك
            const pickedUpOrders  = charityId ? await safeCall(() => getOrdersByCharityIdAndStatus(charityId, 'PICKED_UP')) : [];
            const cancelledOrders = charityId ? await safeCall(() => getOrdersByCharityIdAndStatus(charityId, 'CANCELLED')) : [];


            const allFoods = [
                    ...availableFoods,
                    ...reservedFoods,
                    ...completedFoods,
                    ...expiredFoods,
                    ...cancelledFoods
                ];

const itemsFromFoods = allFoods.map(mapFoodResponseToUiItem);

            const itemsFromOrders = [
                ...pendingOrders,
                ...completedOrders,
                ...pickedUpOrders,
                ...cancelledOrders
            ].map(mapOrderResponseToUiItem);

            allItems = [...itemsFromFoods, ...itemsFromOrders];
            applyFilter(currentFilter);
            return;
        }

        // ✅ fallback
        const foods = await getAllAvailableFood();
        allItems = (Array.isArray(foods) ? foods : []).map(mapFoodResponseToUiItem);
        applyFilter(currentFilter);

    } catch (e) {
        console.error('Error loading data:', e);
        allItems = [];
        applyFilter(currentFilter);
        if (foodList) foodList.innerHTML = '<p style="text-align:center; color:red;">حدث خطأ أثناء جلب البيانات</p>';
    }
}


// Helpers
function isHotel(user) {
    if (!user || !user.roles) return false;
    return user.roles.some(r => r.toUpperCase().includes('HOTEL'));
}

function isCharity(user) {
    if (!user || !user.roles) return false;
    return user.roles.some(r => r.toUpperCase().includes('CHARITY'));
}

// --- Global Actions ---

window.handlePickedUpClick = async function(orderId) {
  if (!isLoggedIn()) {
    alert('⚠️ يجب تسجيل الدخول أولاً.');
    window.location.href = 'login.html';
    return;
  }

  if (!isCharityUser()) {
    alert('⛔ هذه العملية متاحة للجمعيات فقط.');
    return;
  }

  if (!orderId) {
    alert('❌ رقم الطلب غير متوفر.');
    return;
  }

  if (!confirm('تأكيد أنه تم استلام الوجبة؟')) return;

  try {
    await apiMarkAsPickedUp(orderId);
    alert('✅ تم تحويل الحالة إلى: تم التوزيع');
    loadFoods(); // تحديث القوائم
  } catch (error) {
    console.error(error);
    alert('❌ فشل تحديث الحالة: ' + (error.message || 'خطأ غير متوقع'));
  }
};


window.handleContactClick = function(phoneNumber) {
    if (!phoneNumber) alert('رقم الهاتف غير متوفر');
    else window.location.href = `tel:${phoneNumber}`;
};

// --- Rendering ---

function renderFoodCards() {
    const foodList = document.getElementById('foodList');
    const emptyState = document.getElementById('emptyState');
    
    if (!foodList || foodItems.length === 0) {
        if (foodList) foodList.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    let cardsHTML = '';
    
    foodItems.forEach(item => {
        let statusClass = '', statusText = '', buttonHTML = '';
        
        switch ((item.status || '').toLowerCase()){
            case 'available':
    statusClass = 'status-available';
    statusText = 'متاح للطلب';

    // افتراضيًا: فقط "اتصل بالمطعم"
    buttonHTML = `
        <button class="btn-food btn-cancel" onclick="window.handleContactClick('${item.restaurantPhone}')">
            <i class="fas fa-phone"></i> اتصل بالمطعم
        </button>
    `;

    // إذا المستخدم جمعية: أظهر زر الحجز
    if (isCharityUser()) {
        buttonHTML = `
            <button class="btn-food btn-reserve" onclick="window.handleReserveClick(${item.id})">
                <i class="fas fa-shopping-cart"></i> حجز الطعام
            </button>
            <button class="btn-food btn-cancel" onclick="window.handleContactClick('${item.restaurantPhone}')">
                <i class="fas fa-phone"></i> اتصل بالمطعم
            </button>
        `;
    }

    // إذا المستخدم فندق/مطعم: لا تُظهر زر الحجز + رسالة بسيطة
    if (isHotelUser()) {
        buttonHTML = `
            <button class="btn-food btn-disabled" disabled>
                <i class="fas fa-ban"></i> الحجز غير متاح للفنادق
            </button>
            <button class="btn-food btn-cancel" onclick="window.handleContactClick('${item.restaurantPhone}')">
                <i class="fas fa-phone"></i> اتصل بالمطعم
            </button>
        `;
    }

    break;

            case 'reserved':
    statusClass = 'status-reserved';
    statusText = 'محجوز (قيد الانتظار)';

    
    if (isCharityUser() && item.orderId) {
        buttonHTML = `
            <button class="btn-food btn-reserve" onclick="window.handlePickedUpClick(${item.orderId})">
                <i class="fas fa-check-circle"></i> تم الاستلام
            </button>
            <button class="btn-food btn-cancel" onclick="window.handleContactClick('${item.restaurantPhone}')">
                <i class="fas fa-phone"></i> تواصل مع المطعم
            </button>
        `;
    } else {
        // باقي الحسابات (ومنهم المطعم): زي ما هو
        buttonHTML = `
            <button class="btn-food btn-disabled" disabled>
                <i class="fas fa-clock"></i> بانتظار الاستلام
            </button>
            <button class="btn-food btn-cancel" onclick="window.handleContactClick('${item.restaurantPhone}')">
                <i class="fas fa-phone"></i> تواصل مع المطعم
            </button>
        `;
    }
    break;

            case 'delivered':
                statusClass = 'status-delivered';
                statusText = 'مكتمل';
                buttonHTML = `
                    <button class="btn-food btn-disabled" disabled>
                        <i class="fas fa-check-circle"></i> تم الاستلام
                    </button>`;
                break;
            
            case 'expired':
                statusClass = 'status-expired';
                statusText = 'منتهي الصلاحية';
                break;    

            case 'completed':

            case 'picked_up':    
            default:
                statusClass = 'status-available';
                statusText = 'متاح';
        }
        
        cardsHTML += `
            <div class="food-card">
                <div class="food-status ${statusClass}">
                    <span>${statusText}</span>
                    <span class="food-type">${(item.status === 'expired') ? 'منتهي' : item.type}</span>

                </div>
                <div class="food-details">
                    <div class="food-title"><h3>${item.name}</h3></div>
                    <div class="food-info">
                        <div class="food-info-item"><i class="fas fa-weight"></i> <span><strong>الكمية:</strong> ${item.quantity}</span></div>
                        <div class="food-info-item"><i class="fas fa-store"></i> <span><strong>المطعم:</strong> ${item.restaurant}</span></div>
                        <div class="food-info-item"><i class="fas fa-clock"></i> <span><strong>الوقت:</strong> ${item.timeLeft}</span></div>
                    </div>
                </div>
                <div class="food-actions">${buttonHTML}</div>
            </div>
        `;
    });
    
    foodList.innerHTML = cardsHTML;
}

function updateFilterCounts() {
    const counts = {
        all: allItems.length,
        available: allItems.filter(x => x.status === 'available').length,
        reserved: allItems.filter(x => x.status === 'reserved').length,
        expired: allItems.filter(x => x.status === 'expired').length,
        delivered: allItems.filter(x => x.status === 'delivered').length,
    };

    document.querySelectorAll('.filter-btn').forEach(btn => {
        const key = (btn.dataset.filter || 'all').toLowerCase();
        const span = btn.querySelector('.filter-count');
        if (span) span.textContent = counts[key] ?? 0;
    });
}


// --- Initialization ---

document.addEventListener('DOMContentLoaded', function() {
    loadFoods();
        // إخفاء زر "أضف طعام فائض" عن حساب الجمعية
    if (isCharityUser()) {
        const addBtn = document.querySelector('#emptyState a.btn');
        if (addBtn) addBtn.style.display = 'none';
    }


    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            const filterType = this.dataset.filter; // 'all', 'reserved', 'delivered'
            loadFoods({ filterStatus: filterType });

        });
    });
});