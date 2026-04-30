import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, formatPrice as fmtPrice, currencySymbol, round2 } from '../context/SessionContext';
import { socket } from '../context/socket';

export default function ReviewItems() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName]   = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editQty, setEditQty]     = useState(1);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  // Fees: tax, service charges, and auto-detected gratuity all appear here as editable rows.
  const [fees, setFees] = useState(() => {
    const list = [];
    let nextId = 1;
    if (state.tax > 0) list.push({ id: nextId++, type: 'tax', label: 'Tax', amount: state.tax.toFixed(2) });
    if (state.adminFee > 0) list.push({ id: nextId++, type: 'admin', label: 'Service Charge', amount: state.adminFee.toFixed(2) });
    if (state.tipIncluded && state.tipAmount > 0) list.push({ id: nextId++, type: 'gratuity', label: 'Gratuity', amount: state.tipAmount.toFixed(2), detected: true });
    return list;
  });
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Group items for display.
  // Quantity items (quantity > 1) are already a single record — show as-is.
  // Legacy duplicate items (same name+price, quantity=1) are grouped together.
  const groupedItems = useMemo(() => {
    const groups = [];
    const map = new Map();

    for (const item of state.items) {
      if ((item.quantity || 1) > 1) {
        // Already a proper quantity item — treat as its own group
        groups.push({ name: item.name, price: item.price, count: item.quantity, unitPrice: item.unitPrice || item.price / item.quantity, items: [item], isQuantityItem: true });
      } else {
        const key = `${item.name}|||${item.price.toFixed(2)}`;
        if (map.has(key)) {
          map.get(key).items.push(item);
          map.get(key).count += 1;
        } else {
          const group = { name: item.name, price: item.price, count: 1, items: [item], isQuantityItem: false };
          map.set(key, group);
          groups.push(group);
        }
      }
    }
    return groups;
  }, [state.items]);

  function startEdit(item) {
    setEditingId(item.id);
    setEditName(item.name);
    const qty = item.quantity || 1;
    setEditQty(qty);
    // Show unit price in the price field for quantity items; total price for qty=1
    setEditPrice(qty > 1 ? (item.unitPrice || item.price / qty).toFixed(2) : item.price.toFixed(2));
  }

  function saveEdit() {
    if (!editName.trim() || !editPrice) return;
    const unitP = parseFloat(editPrice) || 0;
    const qty   = Math.max(1, editQty);
    dispatch({ type: 'UPDATE_ITEM', id: editingId, updates: {
      name:      editName.trim(),
      price:     round2(unitP * qty),
      quantity:  qty,
      unitPrice: unitP,
    }});
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

  function sumFeesOfType(type) {
    return fees.filter(f => f.type === type).reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
  }

  function handleContinue() {
    const taxTotal = sumFeesOfType('tax');
    const adminTotal = sumFeesOfType('admin');
    const gratuityTotal = round2(sumFeesOfType('gratuity'));
    const hasGratuity = gratuityTotal > 0;

    console.log('[ReviewItems] handleContinue →', { taxTotal, adminTotal, gratuityTotal, hasGratuity, items: state.items.length });
    dispatch({ type: 'SET_TAX', tax: taxTotal });
    dispatch({ type: 'SET_ADMIN_FEE', adminFee: adminTotal });
    dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded: hasGratuity, tipAmount: gratuityTotal });
    // When gratuity is already on the receipt, default to "No tip" so the host
    // isn't accidentally charged an extra 18% on top of the auto-gratuity.
    if (hasGratuity) {
      dispatch({ type: 'SET_TIP_PERCENT', percent: 0 });
      dispatch({ type: 'SET_TIP_DOLLAR', amount: 0 });
    }
    console.log('[ReviewItems] Navigating to /tip');
    navigate('/tip');
  }

  function addFee(type, defaultLabel) {
    const nextId = (fees.length === 0 ? 1 : Math.max(...fees.map(f => f.id)) + 1);
    setFees([...fees, { id: nextId, type, label: defaultLabel, amount: '' }]);
    setShowAddMenu(false);
  }

  function updateFee(id, patch) {
    setFees(fees.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  function removeFee(id) {
    setFees(fees.filter(f => f.id !== id));
  }

  const formatPrice = (p) => fmtPrice(p, state.currency || 'USD');
  const curSym = currencySymbol(state.currency || 'USD');

  // Calculate preview total (fees array now includes gratuity if detected)
  const previewSubtotal = state.subtotal;
  const feesTotal = round2(fees.reduce((s, f) => round2(s + (parseFloat(f.amount) || 0)), 0));
  const previewTotal = round2(previewSubtotal + feesTotal);

  // Check if any item in a group is being edited
  const editingGroup = editingId !== null
    ? groupedItems.find(g => g.items.some(i => i.id === editingId))
    : null;

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/scan')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Scan</button>
      <div className="page-header">
        <h1>Review Items</h1>
        <p>{state.items.length} items found</p>
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
                {/* Name + unit price */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)}
                    placeholder="Item name" style={{ flex: 1 }} />
                  <div style={{ position: 'relative', width: '100px' }}>
                    <input className="input" value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                      placeholder="0.00" type="number" step="0.01" style={{ width: '100%', paddingLeft: editQty > 1 ? '8px' : undefined }} />
                  </div>
                </div>
                {/* Quantity row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span className="text-sm text-muted" style={{ minWidth: '48px' }}>Qty:</span>
                  <button className="btn btn-secondary btn-sm" style={{ width: '32px', padding: '4px' }}
                    onClick={() => setEditQty(Math.max(1, editQty - 1))}>−</button>
                  <span style={{ fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>{editQty}</span>
                  <button className="btn btn-secondary btn-sm" style={{ width: '32px', padding: '4px' }}
                    onClick={() => setEditQty(editQty + 1)}>+</button>
                  {editQty > 1 && (
                    <span className="text-sm text-muted">= {formatPrice((parseFloat(editPrice) || 0) * editQty)} total</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveEdit} style={{ flex: 1 }}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="btn btn-sm" onClick={() => deleteItem(editItem.id)}
                    style={{ color: 'var(--color-accent)', background: 'var(--color-accent-light)' }}>Delete</button>
                </div>
              </div>
            );
          }

          return (
            <div key={group.items[0].id} className="item-row" onClick={() => startEdit(group.items[0])} style={{ cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="item-name">
                  {group.name}
                  {group.count > 1 && (
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '4px' }}>×{group.count}</span>
                  )}
                </span>
                {group.count > 1 && (
                  <span className="text-sm text-muted" style={{ display: 'block', marginTop: '2px' }}>
                    {formatPrice(group.isQuantityItem ? group.unitPrice : group.price)} each
                  </span>
                )}
              </div>
              <span className="item-price">{formatPrice(group.isQuantityItem ? group.price : group.price * group.count)}</span>
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

      {/* Subtotal right under the items */}
      <div className="total-row mt-12" style={{ fontWeight: 700, paddingTop: '12px', borderTop: '1px dashed var(--color-border)' }}>
        <span>Subtotal</span>
        <span>{formatPrice(state.subtotal)}</span>
      </div>

      <p className="text-sm text-muted mt-8 text-center">Tap any item to edit</p>

      <div className="divider" />

      {/* ===== Charges & Fees section ===== */}
      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
        Charges & Fees
      </h3>

      {state.taxNote ? (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#e8f5e9', border: '1px solid #a5d6a7', marginBottom: '12px' }}>
          <p style={{ fontSize: '0.813rem', color: '#2e7d32', fontWeight: 600 }}>ℹ️ {state.taxNote}</p>
        </div>
      ) : fees.length === 0 && (
        <p className="text-sm text-muted" style={{ marginBottom: '12px' }}>
          No extra charges detected. Tap "+ Add expense" below to add one.
        </p>
      )}

      <div className="flex-col gap-12">
        {fees.map((fee) => (
          <div key={fee.id}>
            {fee.detected && (
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1565c0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                🔍 Detected from receipt
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input"
                value={fee.label}
                onChange={(e) => updateFee(fee.id, { label: e.target.value })}
                placeholder="Fee name"
                style={{ flex: 1, borderColor: fee.detected ? '#90caf9' : undefined, background: fee.detected ? '#e3f2fd' : undefined }}
              />
              <div style={{ position: 'relative', width: '120px' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{curSym}</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={fee.amount}
                  onChange={(e) => updateFee(fee.id, { amount: e.target.value })}
                  placeholder="0.00"
                  style={{ paddingLeft: '28px', borderColor: fee.detected ? '#90caf9' : undefined, background: fee.detected ? '#e3f2fd' : undefined }}
                />
              </div>
              <button
                onClick={() => removeFee(fee.id)}
                aria-label="Remove"
                style={{ width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'var(--color-accent-light)', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12" style={{ position: 'relative' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAddMenu(!showAddMenu)}>
          + Add expense
        </button>
        {showAddMenu && (
          <div style={{
            marginTop: '8px',
            background: 'var(--color-surface)',
            border: '1.5px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => addFee('tax', 'Tax')}>Tax / VAT / IVA</button>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => addFee('admin', 'Service Charge')}>Service / Admin Fee</button>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => addFee('admin', '')}>Other / Custom</button>
          </div>
        )}
      </div>

      {/* Preview total */}
      <div className="card card-surface mt-16">
        <div className="total-row">
          <span>Subtotal</span>
          <span className="fw-700">{formatPrice(previewSubtotal)}</span>
        </div>
        {fees.filter(f => (parseFloat(f.amount) || 0) > 0).map((fee) => (
          <div key={fee.id} className="total-row">
            <span className="text-muted">{fee.label || 'Fee'}</span>
            <span>{formatPrice(parseFloat(fee.amount) || 0)}</span>
          </div>
        ))}
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
