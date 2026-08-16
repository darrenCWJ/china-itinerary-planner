import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POLL_MS } from "./tripPayloadCore";
import type { GuestTripPayload, TripPayload } from "./tripShared";
import { useTripPayload } from "./useTripPayload";

const TRIP_ID = "t1";

function payload(overrides: Partial<TripPayload> = {}): TripPayload {
  return {
    id: TRIP_ID,
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Fujian run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["beijing"],
        days: 1,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["food"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [{ id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK" }],
          },
        ],
        tips: [],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing"],
    },
    members: [{ name: "Darren", joinedAt: 1 }],
    checks: [],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: null, rates: {} },
    myMemberName: "Darren",
    ...overrides,
  };
}

function guestBody(): GuestTripPayload {
  return {
    id: TRIP_ID,
    version: 3,
    guest: true,
    tripName: "Fujian run",
    startDate: "2026-12-24",
    days: 1,
    season: "winter",
    destinationNames: ["Beijing"],
    planDays: [],
    packing: [],
    memberCount: 1,
  };
}

function res(status: number, body: unknown = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Queue one response per fetch call, in order; the last one repeats. */
function stubFetch(...responses: ReturnType<typeof res>[]) {
  let call = 0;
  const mock = vi.fn(async (_url: string, _init?: RequestInit) =>
    responses[Math.min(call++, responses.length - 1)]
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Let the awaited fetch/json microtasks settle inside act. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  // vitest runs without globals, so testing-library never registers its own
  // afterEach cleanup — without this every render stacks up in one document.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useTripPayload load states", () => {
  test("a member payload lands as the member state", async () => {
    const fresh = payload();
    stubFetch(res(200, fresh));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    expect(result.current.loadState).toBe("loading");
    await settle();

    expect(result.current.loadState).toBe("member");
    expect(result.current.payload).toEqual(fresh);
  });

  test("a 403 asks for a join code instead of showing the trip", async () => {
    stubFetch(res(403));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    expect(result.current.loadState).toBe("private");
    expect(result.current.payload).toBeNull();
  });

  test("a 404 is a missing trip", async () => {
    stubFetch(res(404));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    expect(result.current.loadState).toBe("not-found");
  });

  test("a server error leaves the load state alone rather than blanking the page", async () => {
    const fresh = payload();
    const fetchMock = stubFetch(res(200, fresh), res(500));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.loadState).toBe("member");
    expect(result.current.payload).toEqual(fresh);
  });

  test("a guest body keeps the redacted view and remembers the code used", async () => {
    localStorage.setItem(`cip-guest-code-${TRIP_ID}`, "ABC123");
    const view = guestBody();
    const fetchMock = stubFetch(res(200, view));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/trips/${TRIP_ID}?code=ABC123`);
    expect(result.current.loadState).toBe("guest");
    expect(result.current.guestView).toEqual(view);
    expect(localStorage.getItem(`cip-guest-code-${TRIP_ID}`)).toBe("ABC123");
  });
});

describe("useTripPayload live sync", () => {
  test("a poll carrying an older version never regresses the trip", async () => {
    const fetchMock = stubFetch(res(200, payload({ version: 5 })), res(200, payload({ version: 4 })));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.payload?.version).toBe(5);
  });

  test("a poll carrying a newer version replaces it", async () => {
    stubFetch(res(200, payload({ version: 5 })), res(200, payload({ version: 6 })));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await settle();

    expect(result.current.payload?.version).toBe(6);
  });

  test("regaining focus refetches immediately", async () => {
    const fetchMock = stubFetch(res(200, payload()));

    renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("becoming visible again refetches immediately", async () => {
    const fetchMock = stubFetch(res(200, payload()));

    renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("unmounting stops the poll and detaches the listeners", async () => {
    const fetchMock = stubFetch(res(200, payload()));

    const { unmount } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 5);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useTripPayload mutate", () => {
  test("a successful mutation applies the returned payload", async () => {
    stubFetch(res(200, payload({ version: 3 })), res(200, payload({ version: 4 })));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = "unset";
    await act(async () => {
      error = await result.current.mutate("/api/trips/t1/tickets", { method: "POST" });
    });

    expect(error).toBeNull();
    expect(result.current.payload?.version).toBe(4);
  });

  test("a rejected mutation returns the server's message and reconciles by force", async () => {
    const fetchMock = stubFetch(
      res(200, payload({ version: 3 })),
      res(400, { error: "Day not found" }),
      res(200, payload({ version: 1 }))
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = null;
    await act(async () => {
      error = await result.current.mutate("/api/trips/t1/plan", { method: "POST" });
    });
    await settle();

    expect(error).toBe("Day not found");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Forced: the reconciling response is older, and still wins.
    expect(result.current.payload?.version).toBe(1);
  });

  test("an unreachable server produces retry copy rather than a thrown error", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (call++ === 0) return res(200, payload());
        throw new Error("offline");
      })
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = null;
    await act(async () => {
      error = await result.current.mutate("/api/trips/t1/plan", { method: "POST" });
    });

    expect(error).toBe("Couldn't reach the server — try again.");
  });
});

describe("useTripPayload toggleCheck", () => {
  test("the tick shows before the server answers, then the server wins", async () => {
    let resolveCheck: ((value: unknown) => void) | null = null;
    const pending = new Promise((r) => {
      resolveCheck = r;
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (call++ === 0) return res(200, payload({ version: 3 }));
        await pending;
        return res(200, payload({ version: 4, checks: [{ key: "item:i1", by: "Darren" }] }));
      })
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let toggling: Promise<void> | null = null;
    await act(async () => {
      toggling = result.current.toggleCheck("item:i1", true, "Darren");
    });

    expect(result.current.payload?.checks).toEqual([{ key: "item:i1", by: "Darren" }]);
    expect(result.current.payload?.version).toBe(3);

    await act(async () => {
      resolveCheck?.(null);
      await toggling;
    });

    expect(result.current.payload?.version).toBe(4);
  });

  test("unticking removes the tick optimistically", async () => {
    stubFetch(res(200, payload({ checks: [{ key: "item:i1", by: "Darren" }] })));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    await act(async () => {
      void result.current.toggleCheck("item:i1", false, "Darren");
    });

    expect(result.current.payload?.checks).toEqual([]);
  });

  test("a failed check forces a refetch so the guess cannot stick", async () => {
    const fetchMock = stubFetch(
      res(200, payload({ version: 3 })),
      res(500),
      res(200, payload({ version: 3, checks: [] }))
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    await act(async () => {
      await result.current.toggleCheck("item:i1", true, "Darren");
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.payload?.checks).toEqual([]);
  });

  test("a non-member cannot tick anything", async () => {
    const fetchMock = stubFetch(res(200, payload()));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    await act(async () => {
      await result.current.toggleCheck("item:i1", true, "Stranger");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.payload?.checks).toEqual([]);
  });
});

describe("useTripPayload join flow", () => {
  test("joining applies the returned payload even though it is not newer", async () => {
    stubFetch(res(200, guestBody()), res(200, payload({ version: 1 })));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();
    expect(result.current.loadState).toBe("guest");

    let error: string | null = "unset";
    await act(async () => {
      error = await result.current.joinTrip(null);
    });

    expect(error).toBeNull();
    expect(result.current.loadState).toBe("member");
    expect(result.current.payload?.version).toBe(1);
  });

  test("a poll already in flight cannot revert a join", async () => {
    let releasePoll: ((value: unknown) => void) | null = null;
    const heldPoll = new Promise((r) => {
      releasePoll = r;
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return res(200, guestBody());
        if (call === 2) {
          await heldPoll;
          return res(200, guestBody());
        }
        return res(200, payload({ version: 1 }));
      })
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await act(async () => {
      await result.current.joinTrip(null);
    });
    expect(result.current.loadState).toBe("member");

    await act(async () => {
      releasePoll?.(null);
    });
    await settle();

    expect(result.current.loadState).toBe("member");
  });

  test("a poll whose body arrives after the join cannot revert it either", async () => {
    // The response lands before the join; only reading its body is slow. The
    // guard has to be rechecked after the parse, not just after the fetch.
    let releaseBody: ((value: unknown) => void) | null = null;
    const heldBody = new Promise((r) => {
      releaseBody = r;
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return res(200, guestBody());
        if (call === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => {
              await heldBody;
              return guestBody();
            },
          };
        }
        return res(200, payload({ version: 1 }));
      })
    );

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await act(async () => {
      await result.current.joinTrip(null);
    });
    expect(result.current.loadState).toBe("member");

    await act(async () => {
      releaseBody?.(null);
    });
    await settle();

    expect(result.current.loadState).toBe("member");
  });

  test("a rejected join returns the server's reason", async () => {
    stubFetch(res(200, guestBody()), res(403, { error: "Wrong code." }));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = null;
    await act(async () => {
      error = await result.current.joinTrip("Mei");
    });

    expect(error).toBe("Wrong code.");
    expect(result.current.loadState).toBe("guest");
  });

  test("claimable names come back as a list, empty when the lookup fails", async () => {
    const fetchMock = stubFetch(res(200, guestBody()), res(200, { claimable: ["Mei"] }), res(500));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let names: string[] = [];
    await act(async () => {
      names = await result.current.loadClaimable();
    });
    expect(names).toEqual(["Mei"]);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/trips/${TRIP_ID}/join?code=`);

    await act(async () => {
      names = await result.current.loadClaimable();
    });
    expect(names).toEqual([]);
  });
});

describe("useTripPayload probeCode", () => {
  test("a wrong code is reported without disturbing the gate", async () => {
    stubFetch(res(403));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = null;
    await act(async () => {
      error = await result.current.probeCode("NOPE");
    });

    expect(error).toBe("Wrong join code — check it and try again.");
    expect(result.current.loadState).toBe("private");
  });

  test("a missing trip and an unreachable server read differently", async () => {
    stubFetch(res(403), res(404), res(500));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = null;
    await act(async () => {
      error = await result.current.probeCode("NOPE");
    });
    expect(error).toBe("Trip not found.");

    await act(async () => {
      error = await result.current.probeCode("NOPE");
    });
    expect(error).toBe("Couldn't check that code — try again.");
  });

  test("an accepted code is adopted and the trip reloads with it", async () => {
    const fetchMock = stubFetch(res(403), res(200, guestBody()));

    const { result } = renderHook(() => useTripPayload(TRIP_ID));
    await settle();

    let error: string | null = "unset";
    await act(async () => {
      error = await result.current.probeCode("ABC123");
    });
    await settle();

    expect(error).toBeNull();
    expect(result.current.loadState).toBe("guest");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`/api/trips/${TRIP_ID}?code=ABC123`);
  });
});
