// project/js/add-food.js
import { isLoggedIn, getCurrentUser } from "../api/claude_api/auth_api.js";
import { getHotelByUserId } from "../api/claude_api/hotel_api.js";
import { createFood } from "../api/claude_api/food_api.js";

function toLocalDateTimeString(dateObj) {
  const p = (n) => String(n).padStart(2, "0");
  return `${dateObj.getFullYear()}-${p(dateObj.getMonth() + 1)}-${p(dateObj.getDate())}T${p(dateObj.getHours())}:${p(dateObj.getMinutes())}:${p(dateObj.getSeconds())}`;
}


function ensureFutureDate(dateStr) {
  // dateStr = "YYYY-MM-DD"
  const today = new Date();
  today.setHours(0,0,0,0);

  const picked = new Date(dateStr + "T00:00:00");
  if (picked <= today) {
    // إذا اختار اليوم أو قبل: نخليها بكرا
    const tmr = new Date(today);
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().slice(0, 10);
  }
  return dateStr;
}


document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("addFoodForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // لازم يكون Hotel/Restaurant مسجل دخول
    if (!isLoggedIn()) {
      alert("⚠️ يجب تسجيل الدخول أولًا.");
      window.location.href = "login.html";
      return;
    }

    const user = getCurrentUser();
    const roles = (user?.roles || []).map(r => (r || "").toUpperCase());

    // منع الجمعية من الإضافة (حسب قرارك السابق)
    if (roles.some(r => r.includes("CHARITY"))) {
      alert("⛔ حساب الجمعية لا يمكنه التبرع. يمكنك فقط حجز الطعام.");
      return;
    }

    const foodType = document.getElementById("foodType").value.trim();
    const foodQuantity = document.getElementById("foodQuantity").value.trim();
    const expiryDateRaw = document.getElementById("expiryDate").value;
    const pickupLocation = document.getElementById("pickupLocation").value.trim();

    if (!foodType || !foodQuantity || !expiryDateRaw || !pickupLocation) {
      alert("⚠️ عبّي كل الحقول.");
      return;
    }
    // ✅ منع تاريخ بالماضي (لأن الباك بيرفضه 400)
const picked = new Date(expiryDateRaw + "T00:00:00");
const today = new Date();
today.setHours(0, 0, 0, 0);

if (picked < today) {
  alert("⚠️ لا يمكنك اختيار تاريخ انتهاء في الماضي.");
  return;
}

    const qty = Number(foodQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert("⚠️ الكمية لازم تكون رقم أكبر من 0.");
      return;
    }

    // لازم Future حسب FoodRequest
    const expiryDate = expiryDateRaw;
    const payload = {
      title: foodType,
      description: pickupLocation,
      quantity: parseInt(foodQuantity, 10),
      // نخلي availableUntil نهاية اليوم المختار
      availableUntil: `${expiryDate}T23:59:59`,
      // نخلي pickupTime بعد ساعة من الآن
      pickupTime: toLocalDateTimeString(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    };

    try {
      // لازم نجيب hotelId من userId
      const hotel = await getHotelByUserId(user.id);
      if (!hotel?.id) throw new Error("لم يتم العثور على ملف الفندق/المطعم لهذا الحساب.");

      await createFood(hotel.id, payload);

      alert("✅ تم إضافة الطعام بنجاح!");
      form.reset();

      // روح على صفحة الطعام المتاح وشوفه
      window.location.href = "food-available.html";

    } catch (err) {
      console.error(err);
      alert("❌ فشل إضافة الطعام: " + (err?.message || "خطأ غير متوقع"));
    }
  });
});
