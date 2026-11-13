'use client';

import { createPortal } from 'react-dom';

export default function Portal({ children }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}
