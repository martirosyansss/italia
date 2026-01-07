import { useState, useEffect } from 'react';
import {
    Plus,
    Search,
    Edit2,
    Trash2,
    User,
    Mail,
    Phone,
    FileText,
    X
} from 'lucide-react';
import ClientForm from './ClientForm';

function ClientList({ onUpdate }) {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingClient, setEditingClient] = useState(null);

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/clients');
            const data = await response.json();
            setClients(data);
        } catch (error) {
            console.error('Ошибка загрузки клиентов:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Вы уверены, что хотите удалить этого клиента?')) return;

        try {
            await fetch(`/api/clients/${id}`, { method: 'DELETE' });
            fetchClients();
            onUpdate?.();
        } catch (error) {
            console.error('Ошибка удаления:', error);
        }
    };

    const handleEdit = (client) => {
        setEditingClient(client);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingClient(null);
    };

    const handleSaveClient = async (clientData) => {
        try {
            if (editingClient) {
                await fetch(`/api/clients/${editingClient.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(clientData)
                });
            } else {
                await fetch('/api/clients', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(clientData)
                });
            }
            fetchClients();
            handleCloseModal();
            onUpdate?.();
        } catch (error) {
            console.error('Ошибка сохранения:', error);
        }
    };

    const filteredClients = clients.filter(client => {
        const query = searchQuery.toLowerCase();
        return (
            client.firstName?.toLowerCase().includes(query) ||
            client.lastName?.toLowerCase().includes(query) ||
            client.email?.toLowerCase().includes(query) ||
            client.phone?.includes(query) ||
            client.passportNumber?.includes(query)
        );
    });

    const getStatusBadge = (status) => {
        const badges = {
            pending: { label: 'Ожидает', className: 'badge-pending' },
            scheduled: { label: 'Записан', className: 'badge-scheduled' },
            completed: { label: 'Завершено', className: 'badge-completed' },
            cancelled: { label: 'Отменено', className: 'badge-cancelled' }
        };
        const badge = badges[status] || badges.pending;
        return <span className={`badge ${badge.className}`}>{badge.label}</span>;
    };

    const getVisaType = (type) => {
        const types = {
            tourist: 'Туристическая',
            business: 'Бизнес',
            student: 'Студенческая',
            work: 'Рабочая',
            family: 'Семейная'
        };
        return types[type] || type;
    };

    return (
        <div>
            <div className="page-header">
                <h2>Клиенты</h2>
                <p>Управление списком клиентов для записи в посольство</p>
            </div>

            {/* Action Bar */}
            <div className="action-bar">
                <div className="action-bar-left">
                    <div style={{ position: 'relative' }}>
                        <Search
                            size={18}
                            style={{
                                position: 'absolute',
                                left: 12,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--text-muted)'
                            }}
                        />
                        <input
                            type="text"
                            className="form-input search-input"
                            placeholder="Поиск по имени, email, телефону..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ paddingLeft: 40 }}
                        />
                    </div>
                </div>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    <Plus size={18} />
                    Добавить клиента
                </button>
            </div>

            {/* Clients Table */}
            <div className="card">
                {loading ? (
                    <div className="empty-state">
                        <div className="spinner"></div>
                        <p style={{ marginTop: 'var(--spacing-md)' }}>Загрузка...</p>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className="empty-state">
                        <User size={48} />
                        <h3>Клиенты не найдены</h3>
                        <p>{searchQuery ? 'Попробуйте изменить параметры поиска' : 'Добавьте первого клиента для начала работы'}</p>
                        {!searchQuery && (
                            <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: 'var(--spacing-lg)' }}>
                                <Plus size={18} />
                                Добавить клиента
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>ФИО</th>
                                    <th>Контакты</th>
                                    <th>Паспорт</th>
                                    <th>Тип визы</th>
                                    <th>Статус</th>
                                    <th>Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredClients.map(client => (
                                    <tr key={client.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                                                <div
                                                    className="stat-icon"
                                                    style={{
                                                        width: 40,
                                                        height: 40,
                                                        fontSize: '0.9rem',
                                                        background: 'var(--gradient-primary)'
                                                    }}
                                                >
                                                    {client.firstName?.[0]}{client.lastName?.[0]}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>
                                                        {client.lastName} {client.firstName} {client.middleName}
                                                    </div>
                                                    {client.birthDate && (
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                            Дата рождения: {new Date(client.birthDate).toLocaleDateString('ru-RU')}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', fontSize: '0.9rem' }}>
                                                    <Mail size={14} style={{ color: 'var(--text-muted)' }} />
                                                    {client.email}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', fontSize: '0.9rem' }}>
                                                    <Phone size={14} style={{ color: 'var(--text-muted)' }} />
                                                    {client.phone}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                                <FileText size={14} style={{ color: 'var(--text-muted)' }} />
                                                {client.passportNumber}
                                            </div>
                                        </td>
                                        <td>{getVisaType(client.visaType)}</td>
                                        <td>{getStatusBadge(client.status)}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                                <button
                                                    className="btn btn-secondary btn-icon btn-sm"
                                                    onClick={() => handleEdit(client)}
                                                    title="Редактировать"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-icon btn-sm"
                                                    onClick={() => handleDelete(client.id)}
                                                    title="Удалить"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {editingClient ? 'Редактирование клиента' : 'Новый клиент'}
                            </h3>
                            <button className="modal-close" onClick={handleCloseModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <ClientForm
                            client={editingClient}
                            onSave={handleSaveClient}
                            onCancel={handleCloseModal}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default ClientList;
