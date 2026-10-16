// The wordmark: "still early." in the serif, lowercase, with the full stop in coral. It is the whole logo (there is no symbol), so it is text, not a picture:
// a screen reader reads the name, and a link around it supplies the purpose ("Go to home"). The size is the page's: set font-size on `className`.
export default function Wordmark({ as: Tag = 'span', className = '' }) {
  return (
    <Tag className={`wordmark${className ? ` ${className}` : ''}`}>
      still early<span className="wordmark-dot" aria-hidden="true">.</span>
    </Tag>
  );
}
