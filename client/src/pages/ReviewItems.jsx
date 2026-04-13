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
  const [adminFeeInput, setAdminFeeInput] = useState(state.adminFee > 0 ? state.adminFee.toFixed(2) : '');
  const [tipIncluded, setTipIncluded] = useState(state.tipIncluded || false);
  const [tipAmountInput, setTipAmountInput] = useState(state.tipAmount > 0 ? state.tipAmount.toFixed(2) : '');

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

  function addItem() {
    if (!newName.trim() || !newPrice) return;
    dispatch({ type: 'ADD_ITEM', name: newName.trim(), price: parseFloat(newPrice) || 0 });
    setNewName('');
    setNewPrice('');
    setAddingNew(false);
  }

  function handleContinue() {
    dispatch({ type: 'SET_TAX', tax: parseFloat(taxInput) || 0 });
    dispatch({ type: 'SET_ADMIN_FEE', adminFee: parseFloat(adminFeeInput) || 0 });
    dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded, tipAmount: parseFloat(tipAmountInput) || 0 });
    navigate('/tip');
  }

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  // Calculate preview total
  const previewSubtotal = state.subtotal;
  const previewTax = parseFloat(taxInput) || 0;
  const previewAdminFee = parseFloat(adminFeeInput) || 0;
  const previewTipAmount = tipIncluded ? (parseFloat(tipAmountInput) || 0) : 0;
  const previewTotal = previewSubtotal + previewTax + previewAdminFee + previewTipAmount;

  // Check if any item in a group is being edited
  const editingGroup = editingId !== null
    ? groupedItems.find(g => g.items.some(i => i.id === editingId))
    : null;

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/scan')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Scan</button>
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

      {/* ===== Charges & Fees section ===== */}
      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
        Charges & Fees
      </h3>

      <div className="flex-col gap-12">
        {/* Tax */}
        <div className="input-group">
          <label className="input-label">Tax</label>
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

        {/* Admin / Service Fee */}
        <div className="input-group">
          <label className="input-label">Admin / Service Fee</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>$</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={adminFeeInput}
              onChange={(e) => setAdminFeeInput(e.target.value)}
              placeholder="0.00"
              style={{ paddingLeft: '32px' }}
            />
          </div>
        </div>

        {/* Tip included toggle */}
        <div
          onClick={() => setTipIncluded(!tipIncluded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: 'var(--radius-lg)',
            border: '1.5px solid var(--color-border)',
            cursor: 'pointer',
            background: tipIncluded ? '#e8f5e9' : 'var(--color-surface)',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Tip already included?</span>
          <div style={{
            width: '44px',
            height: '26px',
            borderRadius: '13px',
            background: tipIncluded ? 'var(--color-accent)' : 'var(--color-border)',
            position: 'relative',
            transition: 'background 0.2s ease',
            flexShrink: 0,
          }}>
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: '3px',
              left: tipIncluded ? '21px' : '3px',
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        {/* Tip amount input — only if tip is included */}
        {tipIncluded && (
          <div className="input-group">
            <label className="input-label">Tip / Gratuity amount</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>$</span>
              <input
                className="input"
                type="number"
                step="0.01"
                value={tipAmountInput}
                onChange={(e) => setTipAmountInput(e.target.value)}
                placeholder="0.00"
                style={{ paddingLeft: '32px' }}
                autoFocus
              />
            </div>
          </div>
        )}
      </div>

      {/* Preview total */}
      <div className="card card-surface mt-16">
        <div className="total-row">
          <span>Subtotal</span>
          <span className="fw-700">{formatPrice(previewSubtotal)}</span>
        </div>
        {previewAdminFee > 0 && (
          <div className="total-row">
            <span className="text-muted">Admin Fee</span>
            <span>{formatPrice(previewAdminFee)}</span>
          </div>
        )}
        <div className="total-row">
          <span className="text-muted">Tax</span>
          <span>{formatPrice(previewTax)}</span>
        </div>
        {tipIncluded && previewTipAmount > 0 && (
          <div className="total-row">
            <span className="text-muted">Tip (included)</span>
            <span>{formatPrice(previewTipAmount)}</span>
          </div>
        )}
        <div className="total-row total-row-final">
          <span>Receipt Total</span>
          <span>{formatPrice(previewTotal)}</span>
        </div>
      </div>

      <p className="text-sm text-muted text-center mt-8">
        Verify these match your receipt before continuing
      </p>

      <div className="spacer" />

      <button
        className="btn btn-primary mt-24"
        onClick={handleContinue}
        disabled={state.items.length === 0}
      >
        Looks Good — Continue
      </button>
    </div>
  );
}
