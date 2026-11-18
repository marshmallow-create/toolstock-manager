export function Brand() {
 return <div className="brand" aria-label="ToolStock Manager">
  <span className="brand-mark" aria-hidden="true">
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
    <path d="m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3L12 2.5Z" />
    <path d="m3.5 7.3 8.5 4.8 8.5-4.8M12 12.1v9.4M7.8 4.9l8.5 4.8" />
   </svg>
  </span>
  <span className="brand-name">ToolStock <span>Manager</span></span>
 </div>;
}
