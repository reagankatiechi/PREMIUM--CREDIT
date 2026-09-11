<<<<<<< HEAD
const slider = document.querySelector('#loanAmount');
const interestOutput = document.querySelector('#interestOutput');
const totalOutput = document.querySelector('#totalOutput');
const formAmount = document.querySelector('#formAmount');
const loanAmountError = document.querySelector('#loanAmountError');
const breakdownPrincipal = document.querySelector('#breakdownPrincipal');
const breakdownInterest = document.querySelector('#breakdownInterest');
const breakdownTotal = document.querySelector('#breakdownTotal');
const repaymentRows = document.querySelector('#repaymentRows');
const money = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
const currency = amount => `KSh ${money.format(amount)}`;
const dateFormat = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

// Local PostgreSQL Express Server Endpoint
const API_URL = 'http://localhost:3000/api/applications';

function renderRepaymentSchedule(principal, interest, total) {
  breakdownPrincipal.textContent = currency(principal);
  breakdownInterest.textContent = currency(interest);
  breakdownTotal.textContent = currency(total);

  const dailyPrincipal = principal / 10;
  const baseDailyTotal = Math.floor(total / 10);
  const finalDailyTotal = total - (baseDailyTotal * 9);
  const today = new Date();
  repaymentRows.innerHTML = Array.from({ length: 10 }, (_, index) => {
    const dueDate = new Date(today);
    dueDate.setDate(today.getDate() + index + 1);
    const day = index + 1;
    const dailyTotal = day === 10 ? finalDailyTotal : baseDailyTotal;
    return `<tr><th scope="row">Day ${day}</th><td>${dateFormat.format(dueDate)}</td><td>${currency(dailyPrincipal)}</td><td><strong>${currency(dailyTotal)}</strong></td></tr>`;
  }).join('');
}

function updateLoan(value) {
  const interest = value * 0.2;
  const total = value + interest;
  interestOutput.textContent = currency(interest);
  totalOutput.textContent = currency(total);
  formAmount.value = currency(value);
  renderRepaymentSchedule(value, interest, total);
}

function validateAndUpdateLoan() {
  const value = Number(slider.value);
  let error = '';
  if (!slider.value) error = 'Enter a loan amount to view your repayment schedule.';
  else if (value < 500) error = 'Minimum loan amount is KSh 500.';
  else if (value > 50000) error = 'Maximum loan amount is KSh 50,000.';
  else if (value % 100 !== 0) error = 'Please enter an amount in increments of KSh 100.';
  if (error) {
    slider.classList.add('is-invalid');
    slider.setAttribute('aria-invalid', 'true');
    loanAmountError.textContent = error;
    loanAmountError.hidden = false;
    return false;
  }
  slider.classList.remove('is-invalid');
  slider.removeAttribute('aria-invalid');
  loanAmountError.hidden = true;
  updateLoan(value);
  return true;
}

slider.addEventListener('input', validateAndUpdateLoan);
slider.addEventListener('change', validateAndUpdateLoan);
validateAndUpdateLoan();

const form = document.querySelector('#loanForm');
const steps = [...form.querySelectorAll('.form-step')];
const progressSteps = [...form.querySelectorAll('[data-progress]')];
let activeStep = 1;

function showStep(stepNumber) {
  activeStep = stepNumber;
  steps.forEach(step => {
    const isActive = Number(step.dataset.step) === stepNumber;
    step.hidden = !isActive;
    step.classList.toggle('is-active', isActive);
  });
  progressSteps.forEach(item => {
    const step = Number(item.dataset.progress);
    item.classList.toggle('is-active', step === stepNumber);
    item.classList.toggle('is-complete', step < stepNumber);
    item.querySelector('span').textContent = step < stepNumber ? '✓' : step;
  });
  document.querySelector('#formMessage').textContent = '';
}

function validateCurrentStep() {
  if (activeStep === 1 && !validateAndUpdateLoan()) return false;
  const currentStep = form.querySelector(`.form-step[data-step="${activeStep}"]`);
  const fields = [...currentStep.querySelectorAll('input, select, textarea')];
  const invalidField = fields.find(field => !field.checkValidity());
  if (invalidField) {
    invalidField.reportValidity();
    document.querySelector('#formMessage').textContent = 'Please complete the required fields before continuing.';
    return false;
  }
  return true;
}

form.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => {
  if (validateCurrentStep()) showStep(activeStep + 1);
}));
form.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => showStep(activeStep - 1)));

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.querySelector('#formMessage');
  if (!validateCurrentStep()) {
    return;
  }

  const applicantName = form.elements.name.value.trim();
  const phone = form.elements.phone.value.trim();
  const principal = Number(slider.value);

  // Formatted flat payload matching backend server parameters
  const payload = {
    loan_amount: principal,
    repayment_period: 10,
    applicant_name: applicantName,
    id_number: form.elements.applicantId.value.trim(),
    phone_number: phone,
    employment_type: form.elements.employmentStatus.value,
    monthly_income: Number(form.elements.monthlyIncome.value),
    next_of_kin_name: form.elements.kinName.value.trim(),
    next_of_kin_phone: form.elements.kinPhone.value.trim()
  };

  const submitButton = form.querySelector('[type="submit"]');
  const originalButtonContent = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  submitButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span> Submitting...';
  message.textContent = '';
  message.classList.remove('is-error');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || `Server responded with ${response.status}`);
    }

    document.querySelector('#successMessage').textContent = `Thank you for your application, ${applicantName}! Your request for ${currency(principal)} is being reviewed. We will contact you within 60 minutes on ${phone}.`;
    successModal.hidden = false;
    document.body.classList.add('modal-open');
    form.reset();
    slider.value = 1000;
    validateAndUpdateLoan();
    showStep(1);
  } catch (error) {
    message.textContent = 'Submission failed. Please check your network or try again.';
    message.classList.add('is-error');
    console.error('Application database submission failed:', error);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
    submitButton.innerHTML = originalButtonContent;
  }
});

const successModal = document.querySelector('#successModal');
function closeSuccessModal() {
  successModal.hidden = true;
  document.body.classList.remove('modal-open');
}

document.querySelector('#closeSuccess').addEventListener('click', closeSuccessModal);
document.querySelector('#closeSuccessIcon').addEventListener('click', closeSuccessModal);
successModal.addEventListener('click', event => {
  if (event.target === successModal) closeSuccessModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !successModal.hidden) closeSuccessModal();
});
=======
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
>>>>>>> cfdacab002df4b9801e69402bb456b11bc2d24b6
