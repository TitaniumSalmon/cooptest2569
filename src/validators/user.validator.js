const validateRegister = ({ name, email, password, role }) => {
    const errors = [];
    if (!name || name.trim().length < 2 || name.trim().length > 100)
        errors.push({ field: 'name', message: 'Name must be between 2 and 100 characters' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ field: 'email', message: 'Invalid email format' });
    if (!password || !/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password))
        errors.push({ field: 'password', message: 'Password must be at least 8 characters with at least 1 letter and 1 number' });
    if (role && !['admin', 'user'].includes(role))
        errors.push({ field: 'role', message: 'Role must be admin or user' });
    return errors;
};

const validateUpdate = ({ name, email }) => {
    const errors = [];
    if (name !== undefined && (name.trim().length < 2 || name.trim().length > 100))
        errors.push({ field: 'name', message: 'Name must be between 2 and 100 characters' });
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ field: 'email', message: 'Invalid email format' });
    return errors;
};

module.exports = { validateRegister, validateUpdate };
