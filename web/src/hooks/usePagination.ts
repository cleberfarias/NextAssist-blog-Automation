import { useState } from "react";

interface UsePaginationResult<T> {
  page: number;
  totalPages: number;
  pageItems: T[];
  next: () => void;
  previous: () => void;
}

export function usePagination<T>(items: T[], pageSize: number): UsePaginationResult<T> {
  const [requestedPage, setRequestedPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Clampa aqui (em vez de useEffect) para nunca renderizar uma página que já
  // não existe mais no meio de uma troca de dados (ex: workspace mudou e a
  // lista encolheu) — sem isso haveria um frame com pageItems vazio.
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    page,
    totalPages,
    pageItems,
    next: () => setRequestedPage((p) => Math.min(p + 1, totalPages)),
    previous: () => setRequestedPage((p) => Math.max(p - 1, 1)),
  };
}
