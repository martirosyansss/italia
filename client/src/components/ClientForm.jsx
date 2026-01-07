import { useState, useEffect } from 'react';

function ClientForm({ client, onSave, onCancel }) {
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        middleName: '',
        email: '',
        phone: '',
        passportNumber: '',
        passportExpiry: '',
        birthDate: '',
        visaType: 'tourist',
        preferredDates: '',
        notes: '',
        status: 'pending'
    });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (client) {
            setFormData({
                firstName: client.firstName || '',
                lastName: client.lastName || '',
                middleName: client.middleName || '',
                email: client.email || '',
                phone: client.phone || '',
                passportNumber: client.passportNumber || '',
                passportExpiry: client.passportExpiry || '',
                birthDate: client.birthDate || '',
                visaType: client.visaType || 'tourist',
                preferredDates: client.preferredDates || '',
                notes: client.notes || '',
                status: client.status || 'pending'
            });
        }
    }, [client]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        // Очистка ошибки при изменении
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }
    };

    const validate = () => {
        const newErrors = {};

        if (!formData.firstName.trim()) newErrors.firstName = 'Обязательное поле';
        if (!formData.lastName.trim()) newErrors.lastName = 'Обязательное поле';
        if (!formData.email.trim()) newErrors.email = 'Обязательное поле';
        else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Неверный формат email';
        if (!formData.phone.trim()) newErrors.phone = 'Обязательное поле';
        if (!formData.passportNumber.trim()) newErrors.passportNumber = 'Обязательное поле';

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validate()) return;

        setLoading(true);
        try {
            await onSave(formData);
        } catch (error) {
            console.error('Ошибка сохранения:', error);
        } finally {
            setLoading(false);
        }
    };

    const visaTypes = [
        { value: 'tourist', label: 'Туристическая' },
        { value: 'business', label: 'Бизнес' },
        { value: 'student', label: 'Студенческая' },
        { value: 'work', label: 'Рабочая' },
        { value: 'family', label: 'Семейная' }
    ];

    const statusOptions = [
        { value: 'pending', label: 'Ожидает записи' },
        { value: 'scheduled', label: 'Записан' },
        { value: 'completed', label: 'Завершено' },
        { value: 'cancelled', label: 'Отменено' }
    ];

    return (
        <form onSubmit={handleSubmit}>
            {/* Личные данные */}
            <h4 style={{ marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                Личные данные
            </h4>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Фамилия *</label>
                    <input
                        type="text"
                        name="lastName"
                        className={`form-input ${errors.lastName ? 'error' : ''}`}
                        value={formData.lastName}
                        onChange={handleChange}
                        placeholder="Иванов"
                    />
                    {errors.lastName && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>{errors.lastName}</span>}
                </div>
                <div className="form-group">
                    <label className="form-label">Имя *</label>
                    <input
                        type="text"
                        name="firstName"
                        className={`form-input ${errors.firstName ? 'error' : ''}`}
                        value={formData.firstName}
                        onChange={handleChange}
                        placeholder="Иван"
                    />
                    {errors.firstName && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>{errors.firstName}</span>}
                </div>
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Отчество</label>
                    <input
                        type="text"
                        name="middleName"
                        className="form-input"
                        value={formData.middleName}
                        onChange={handleChange}
                        placeholder="Иванович"
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">Дата рождения</label>
                    <input
                        type="date"
                        name="birthDate"
                        className="form-input"
                        value={formData.birthDate}
                        onChange={handleChange}
                    />
                </div>
            </div>

            {/* Контакты */}
            <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                Контактные данные
            </h4>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Email *</label>
                    <input
                        type="email"
                        name="email"
                        className={`form-input ${errors.email ? 'error' : ''}`}
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="email@example.com"
                    />
                    {errors.email && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>{errors.email}</span>}
                </div>
                <div className="form-group">
                    <label className="form-label">Телефон *</label>
                    <input
                        type="tel"
                        name="phone"
                        className={`form-input ${errors.phone ? 'error' : ''}`}
                        value={formData.phone}
                        onChange={handleChange}
                        placeholder="+7 (999) 123-45-67"
                    />
                    {errors.phone && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>{errors.phone}</span>}
                </div>
            </div>

            {/* Паспортные данные */}
            <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                Паспортные данные
            </h4>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Номер паспорта *</label>
                    <input
                        type="text"
                        name="passportNumber"
                        className={`form-input ${errors.passportNumber ? 'error' : ''}`}
                        value={formData.passportNumber}
                        onChange={handleChange}
                        placeholder="75 1234567"
                    />
                    {errors.passportNumber && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>{errors.passportNumber}</span>}
                </div>
                <div className="form-group">
                    <label className="form-label">Срок действия</label>
                    <input
                        type="date"
                        name="passportExpiry"
                        className="form-input"
                        value={formData.passportExpiry}
                        onChange={handleChange}
                    />
                </div>
            </div>

            {/* Виза */}
            <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                Виза
            </h4>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Тип визы</label>
                    <select
                        name="visaType"
                        className="form-input form-select"
                        value={formData.visaType}
                        onChange={handleChange}
                    >
                        {visaTypes.map(type => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                    </select>
                </div>
                {client && (
                    <div className="form-group">
                        <label className="form-label">Статус</label>
                        <select
                            name="status"
                            className="form-input form-select"
                            value={formData.status}
                            onChange={handleChange}
                        >
                            {statusOptions.map(status => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <div className="form-group">
                <label className="form-label">Предпочтительные даты</label>
                <input
                    type="text"
                    name="preferredDates"
                    className="form-input"
                    value={formData.preferredDates}
                    onChange={handleChange}
                    placeholder="Например: с 15 по 25 января"
                />
            </div>

            <div className="form-group">
                <label className="form-label">Примечания</label>
                <textarea
                    name="notes"
                    className="form-input"
                    value={formData.notes}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Дополнительная информация о клиенте..."
                    style={{ resize: 'vertical' }}
                />
            </div>

            {/* Footer */}
            <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onCancel}>
                    Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? (
                        <>
                            <span className="spinner" style={{ width: 16, height: 16 }}></span>
                            Сохранение...
                        </>
                    ) : (
                        client ? 'Сохранить изменения' : 'Добавить клиента'
                    )}
                </button>
            </div>
        </form>
    );
}

export default ClientForm;
