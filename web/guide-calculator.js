// 동일 주문 금액을 정액/정률 쿠폰으로 비교. 실제 행사·중복 적용 계산은 아니다.
export function compareDiscounts({ amount, fixed, rate, cap }) {
  if (![amount, fixed, rate, cap].every(Number.isFinite) || amount <= 0 || amount > 100000000 || fixed < 0 || cap < 0 || rate < 0 || rate > 100 || fixed > 100000000 || cap > 100000000) return null;
  if (![amount, fixed, cap].every(Number.isInteger)) return null;
  const fixedDiscount = Math.min(amount, fixed);
  const rateDiscount = Math.min(amount, Math.floor(amount * rate / 100), cap > 0 ? cap : Infinity);
  return { fixedPayment: amount - fixedDiscount, ratePayment: amount - rateDiscount, difference: Math.abs(fixedDiscount - rateDiscount) };
}

if (typeof document !== 'undefined') {
  const form = document.getElementById('discountCalculator');
  if (form) {
    const output = document.getElementById('comparisonResult');
    const calculate = () => {
      const values = Object.fromEntries(['amount', 'fixed', 'rate', 'cap'].map(name => {
        const raw = form.elements.namedItem(name).value.trim();
        return [name, raw === '' ? NaN : Number(raw)];
      }));
      const result = compareDiscounts(values);
      if (!result) { output.textContent = '주문금액과 할인 조건을 확인해 주세요. 금액은 0 이상의 원 단위, 할인율은 0~100%로 입력해 주세요.'; return; }
      const won = n => `${n.toLocaleString('ko-KR')}원`;
      output.textContent = `정액 쿠폰: ${won(result.fixedPayment)} 결제 · 정률 쿠폰: ${won(result.ratePayment)} 결제. ` + (result.difference === 0 ? '결제 금액이 같아요.' : `${result.fixedPayment < result.ratePayment ? '정액' : '정률'} 쿠폰이 ${won(result.difference)} 더 저렴해요.`);
    };
    form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
    calculate();
  }
}
