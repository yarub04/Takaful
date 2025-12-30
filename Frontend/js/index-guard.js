// project/js/index-guard.js
import { isLoggedIn } from "../api/claude_api/auth_api.js";
import { isCharityUser } from "./role-guard.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("addFoodForm");
  if (!form) return;

  // لو مش مسجل دخول، اترك الصفحة طبيعية
  if (!isLoggedIn()) return;

  // لو جمعية: اخفي قسم الإضافة بالكامل + امنع الإرسال
  if (isCharityUser()) {
    // اخفي الكارد (الحاوية) اللي فيها الفورم
    const card = form.closest(".card");
    if (card) card.style.display = "none";

    // اخفي عنوان السكشن اللي قبله (التبرع بالطعام الفائض)
    const sectionHeaders = document.querySelectorAll(".section-header");
    sectionHeaders.forEach(h => {
      const text = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (text.includes("التبرع") || text.includes("إضافة طعام")) {
        h.style.display = "none";
      }
    });

    // اعرض رسالة بديلة واضحة
    const msg = document.createElement("div");
    msg.className = "card";
    msg.style.padding = "18px";
    msg.style.marginTop = "20px";
    msg.innerHTML = `
      <h3 style="margin:0 0 8px 0;">تنبيه</h3>
      <p style="margin:0;">
        حساب الجمعية لا يمكنه التبرع أو إضافة طعام. بإمكانك فقط <strong>حجز الطعام</strong> من صفحة "الطعام المتاح".
      </p>
      <a href="food-available.html" class="btn btn-primary" style="margin-top:12px; display:inline-block;">
        الذهاب للطعام المتاح
      </a>
    `;

    // حط الرسالة مكان الفورم تقريبًا
    const main = document.querySelector("main") || document.body;
    main.appendChild(msg);

    // منع أي submit لو صار
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      alert("حساب الجمعية لا يمكنه التبرع أو إضافة طعام. يمكنك فقط حجز الطعام.");
    });
  }
});
