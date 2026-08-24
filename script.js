const slider = document.querySelector('#loanAmount');
const amountOutput = document.querySelector('#amountOutput');
const interestOutput = document.querySelector('#interestOutput');
const totalOutput = document.querySelector('#totalOutput');
const formAmount = document.querySelector('#formAmount');
const money = new Intl.NumberFormat('en-US');

function updateLoan(amount) {
  const value = Math.min(50000, Math.max(500, Number(amount) || 500));
  const interest = value * 0.2;
  amountOutput.textContent = money.format(value);
  interestOutput.textContent = money.format(interest);
  totalOutput.textContent = money.format(value + interest);
  formAmount.value = value;
  slider.value = value;
  slider.style.setProperty('--fill', `${((value - 500) / 49500) * 100}%`);
}
slider.addEventListener('input', e => updateLoan(e.target.value));
formAmount.addEventListener('change', e => updateLoan(e.target.value));
updateLoan(slider.value);

document.querySelector('#loanForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#formMessage');
  if (!form.checkValidity()) {
    form.reportValidity();
    message.textContent = 'Please complete all required fields.';
    return;
  }
  message.textContent = 'Thanks! Your quick-loan request is ready for review.';
  form.reset();
  updateLoan(1000);
});
