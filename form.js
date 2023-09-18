const form = document.getElementById('registrationForm');
const inputs = {
    fullName: { element: document.getElementById('fullName'), regex: /^[a-zA-Z\s]{3,}$/ },
    email: { element: document.getElementById('email'), regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    password: { element: document.getElementById('password'), regex: /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/ },
    confirmPassword: { element: document.getElementById('confirmPassword'), regex: /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/ },
    dob: { element: document.getElementById('dob'), regex: /^\d{4}-\d{2}-\d{2}$/ }
};
const ageMessage = document.getElementById('ageMessage');
const submitButton = document.getElementById('submitButton');

form.addEventListener('submit', function (e) {
    e.preventDefault();

    let isValid = true;

    for (const inputKey in inputs) {
        const input = inputs[inputKey];
        if (!input.regex.test(input.element.value)) {
            showError(input.element, `${inputKey} is invalid.`);
            isValid = false;
        } else {
            clearError(input.element);
        }
    }

    if (inputs.password.element.value !== inputs.confirmPassword.element.value) {
        showError(inputs.confirmPassword.element, 'Passwords do not match.');
        isValid = false;
    } else {
        clearError(inputs.confirmPassword.element);
    }

    const dobValue = inputs.dob.element.value;
    const dobDate = new Date(dobValue);
    const today = new Date();
    
    if (isNaN(dobDate.getTime()) || dobDate > today) {
        ageMessage.textContent = 'Invalid date of birth.';
        isValid = false;
    } else {
        const age = today.getFullYear() - dobDate.getFullYear();
        if (today.getMonth() < dobDate.getMonth() || (today.getMonth() === dobDate.getMonth() && today.getDate() < dobDate.getDate())) {
            age--;
        }
        
        if (age < 18) {
            ageMessage.textContent = 'You must be at least 18 years old.';
            isValid = false;
        } else {
            ageMessage.textContent = '';
        }
    }

    submitButton.disabled = !isValid;

    if (isValid) {
        form.submit();
    }
});

for (const inputKey in inputs) {
    const input = inputs[inputKey];
    input.element.addEventListener('input', function () {
        if (input.regex.test(input.element.value)) {
            clearError(input.element);
            showSuccess(input.element);
        } else {
            showError(input.element, `${inputKey} is invalid.`);
        }
        updateSubmitButtonState();
    });
}

function showError(input, message) {
    const errorContainer = input.nextElementSibling;
    errorContainer.textContent = message;
    errorContainer.classList.remove('success');
    errorContainer.classList.add('error');
}

function showSuccess(input) {
    const successContainer = input.nextElementSibling;
    successContainer.textContent = '✓';
    successContainer.classList.remove('error');
    successContainer.classList.add('success');
}

function clearError(input) {
    const errorContainer = input.nextElementSibling;
    errorContainer.textContent = '';
    errorContainer.classList.remove('error', 'success');
}

function updateSubmitButtonState() {
    submitButton.disabled = Object.values(inputs).some(input => !input.regex.test(input.element.value)) || ageMessage.textContent !== '';
}
