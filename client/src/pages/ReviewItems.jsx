import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

export default function ReviewItems() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [taxInput, setTaxInput] = useState(state.tax > 0 ? state.tax.toFixed(2) : '');

  // Group items by name + price for display
  const groupedItems = useMemo(() => {
    const groups = [];
    const map = new Map();

    for (const item of state.items) {
      const key = `${item.name}|||${item.price.toFixed(2)}`;
      if (map.has(key)) {
        map.get(key).items.push(item);
        map.get(key).count += 1;
      } else {
        const group = { name: item.name, price: item.price, count: 1, items: [item] };
        map.set(key, group);
        groups.push(group);
      }
    }
    return groups;
  }, [state.items]);

  function startEdit(item) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(item.price.toFixed(2));
  }

  function saveEdit() {
    if (!editName.trim() || !editPrice) return;
    dispatch({ type: 'UPDATE_ITEM', id: editingId, updates: { name: editName.trim(), price: parseFloat(editPrice) || 0 } });
    setEditingId(null);
  }

  function deleteItem(id) {
    dispatch({ type: 'DELETE_ITEM', id });
    if (editingId === id) setEditingId(null);
  }

  function deleteGroup(group) {
    for (const item of group.items) {
      dispatch({ type: 'DELETE_ITEM', id: item.id });
    }
  }

  function addItem() {
    if (!newName.trim() || !newPrice) return;
    dispatch({ type: 'ADD_ITEM', name: newName.trim(), price: parseFloat(newPrice) || 0 });
    setNewName('');
    setNewPrice('');
    setAddingNew(false);
  }

  function handleContinue() {
    dispatch({ type: 'SET_TAX', tax: parseFloat(taxInput) || 0 });
    navigate('/tip');
  }

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  // Check if any item in a group is being edited
  const editingGroup = editingId !== null
    ? groupedItems.find(g => g.items.some(i => i.id === editingId))
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Review Items</h1>
        <p>{state.items.length} items found &middot; {formatPrice(state.subtotal)} subtotal</p>
      </div>

      <div className="card">
        {state.items.length === 0 && !addingNew && (
          <div className="text-center" style={{ padding: '24px 0' }}>
            <p className="text-muted">No items yet. Add them manually below.</p>
          </div>
        )}

        {groupedItems.map((group) => {
          const isEditingThisGroup = editingGroup === group;

          if (isEditingThisGroup) {
            const editItem = group.items.find(i => i.id === editingId);
            return (
              <div key={editItem.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    className="input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Item name"
                    style={{ flex: 1 }}
                  />
                  <input
                    className="input"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                    style={{ width: '100px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveEdit} style={{ flex: 1 }}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="btn btn-sm" onClick={() => deleteItem(editItem.id)} style={{ color: 'var(--color-accent)', background: 'var(--color-accent-light)' }}>Delete</button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={group.items[0].id}
              className="item-row"
              onClick={() => startEdit(group.items[0])}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="item-name">{group.name}</span>
                {group.count > 1 && (
                  <span className="text-sm text-muted" style={{ display: 'block', marginTop: '2px' }}>
                    {group.count} x {formatPrice(group.price)} each
                  </span>
                )}
              </div>
              <span className="item-price">{formatPrice(group.price * group.count)}</span>
            </div>
          );
        })}

        {addingNew && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Item name"
                autoFocus
                style={{ flex: 1 }}
              />
              <input
                className="input"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="0.00"
                type="number"
                step="0.01"
                style={{ width: '100px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary btn-sm" onClick={addItem} style={{ flex: 1 }}>Add</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {!addingNew && (
        <button className="btn btn-secondary btn-sm mt-12" onClick={() => setAddingNew(true)}>
          + Add Item
        </button>
      )}

      <p className="text-sm text-muted mt-8 text-center">Tap any item to edit</p>

      <div className="divider" />

      <div className="input-group">
        <label className="input-label">Tax amount</label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>$</span>
          <input
            className="input"
            type="number"
            step="0.01"
            value={taxInput}
            onChange={(e) => setTaxInput(e.target.value)}
            placeholder="0.00"
            style={{ paddingLeft: '32px' }}
          />
        </div>
      </div>

      <div className="spacer" />

      <button
        className="btn btn-primary mt-24"
        onClick={handleContinue}
        disabled={state.items.length === 0}
      >
        Continue
      </button>
    </div>
  );
}
