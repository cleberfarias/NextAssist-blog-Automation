import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "./usePagination";

describe("usePagination", () => {
  it("slices the first page by default", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result } = renderHook(() => usePagination(items, 6));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageItems).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("advances and retreats pages, clamped to bounds", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result } = renderHook(() => usePagination(items, 6));

    act(() => result.current.next());
    expect(result.current.page).toBe(2);

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3); // não passa de totalPages

    act(() => result.current.previous());
    act(() => result.current.previous());
    act(() => result.current.previous());
    expect(result.current.page).toBe(1); // não fica negativo
  });

  it("clamps to the last valid page when the item list shrinks", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result, rerender } = renderHook(({ list }) => usePagination(list, 6), {
      initialProps: { list: items },
    });

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3);

    rerender({ list: items.slice(0, 3) });
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(1);
  });
});
