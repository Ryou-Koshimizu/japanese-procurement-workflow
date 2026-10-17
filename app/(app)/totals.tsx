import type { Totals as T } from '../../src/core/money';
import { yen } from '../../src/core/money';

/** Totals by tax rate, as a qualified invoice lists them. */
export default function Totals({
  totals,
  shippingFee,
  expenses,
  label = '合計（税込）',
}: {
  totals: T;
  shippingFee?: number;
  expenses?: number;
  label?: string;
}) {
  return (
    <dl className="totals num">
      {!!shippingFee && (
        <div>
          <dt>送料（10%対象に含む）</dt>
          <dd>{yen(shippingFee)}</dd>
        </div>
      )}
      {!!expenses && (
        <div>
          <dt>諸経費（10%対象に含む）</dt>
          <dd>{yen(expenses)}</dd>
        </div>
      )}
      <div>
        <dt>10%対象</dt>
        <dd>{yen(totals.subtotal10)}</dd>
      </div>
      <div>
        <dt>消費税（10%）</dt>
        <dd>{yen(totals.tax10)}</dd>
      </div>
      {(totals.subtotal8 > 0 || totals.tax8 > 0) && (
        <>
          <div>
            <dt>8%対象（軽減税率）</dt>
            <dd>{yen(totals.subtotal8)}</dd>
          </div>
          <div>
            <dt>消費税（8%）</dt>
            <dd>{yen(totals.tax8)}</dd>
          </div>
        </>
      )}
      <div className="grand">
        <dt>{label}</dt>
        <dd>{yen(totals.total)}</dd>
      </div>
    </dl>
  );
}
