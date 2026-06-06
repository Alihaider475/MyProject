// Shared frontend utility helpers
export const formatCurrency = (amount, currency = 'PKR') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
};
