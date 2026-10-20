/** The name at the left of the header: a stamp and the product name. */
export default function Brand({ sub }: { sub?: string }) {
  return (
    <a className="brand" href="/">
      <span className="seal" aria-hidden="true">
        発
      </span>
      <span className="brand-text">
        <b>
          <span>備品発注</span>
          <span>ワークフロー</span>
        </b>
        {sub && <small>{sub}</small>}
      </span>
    </a>
  );
}
