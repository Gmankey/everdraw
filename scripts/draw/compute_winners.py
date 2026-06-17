#!/usr/bin/env python3
import json
import sys

ALGO_VERSION = "everdraw-v5-draw-algorithm/1"
ZERO_ROOT = "0x" + "00" * 32

RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
R = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]


def rol(x, n):
    return ((x << n) | (x >> (64 - n))) & ((1 << 64) - 1)


def keccak_f(state):
    for rc in RC:
        c = [state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x + 5 * y] ^= d[x]
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(state[x + 5 * y], R[x][y])
        for x in range(5):
            for y in range(5):
                state[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])
        state[0] ^= rc


def keccak256(data):
    rate = 136
    state = [0] * 25
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % rate != rate - 1:
        padded.append(0)
    padded.append(0x80)
    for offset in range(0, len(padded), rate):
        block = padded[offset:offset + rate]
        for i in range(rate // 8):
            state[i] ^= int.from_bytes(block[i * 8:(i + 1) * 8], "little")
        keccak_f(state)
    out = bytearray()
    while len(out) < 32:
        for i in range(rate // 8):
            out.extend(state[i].to_bytes(8, "little"))
        if len(out) < 32:
            keccak_f(state)
    return bytes(out[:32])


def hx(b):
    return "0x" + b.hex()


def norm_addr(addr):
    addr = addr.lower()
    if not addr.startswith("0x") or len(addr) != 42:
        raise ValueError("bad address " + addr)
    int(addr[2:], 16)
    return addr


def bytes32(value):
    value = value.lower()
    if not value.startswith("0x") or len(value) != 66:
        raise ValueError("bad bytes32 " + value)
    return bytes.fromhex(value[2:])


def word_uint(value):
    value = int(value)
    if value < 0:
        raise ValueError("negative uint")
    return value.to_bytes(32, "big")


def word_addr(addr):
    return b"\x00" * 12 + bytes.fromhex(norm_addr(addr)[2:])


def abi_hash(parts):
    data = bytearray()
    for kind, value in parts:
        if kind == "bytes32":
            data.extend(bytes32(value) if isinstance(value, str) else value)
        elif kind == "uint256":
            data.extend(word_uint(value))
        elif kind == "address":
            data.extend(word_addr(value))
        else:
            raise ValueError("bad kind " + kind)
    return keccak256(bytes(data))


LEAF_DOMAIN = hx(keccak256(b"EverDraw.V5.ClaimLeaf"))


def merkle_root(leaves):
    if not leaves:
        return ZERO_ROOT
    level = sorted(leaf.lower() for leaf in leaves)
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 == len(level):
                nxt.append(level[i])
            else:
                a, b = sorted([level[i], level[i + 1]])
                nxt.append(hx(keccak256(bytes.fromhex(a[2:] + b[2:]))))
        level = sorted(nxt)
    return level[0]


def compute(raw):
    draw_id = int(raw["drawId"])
    draw_manager = norm_addr(raw["drawManager"])
    seed = raw["seed"].lower()
    accounts = sorted(
        [{"address": norm_addr(a["address"]), "twab": int(a["twab"])} for a in raw["accounts"] if int(a["twab"]) > 0],
        key=lambda a: a["address"],
    )
    prize_legs = [{"token": norm_addr(l["token"]), "amount": int(l["amount"])} for l in raw["prizeLegs"]]
    tier_bps = [int(x) for x in raw["tierBps"]]
    total_twab = sum(a["twab"] for a in accounts)
    if total_twab == 0:
        return {"algoVersion": ALGO_VERSION, "root": ZERO_ROOT, "totalTwab": "0", "totalPayout": str(sum(l["amount"] for l in prize_legs)), "winnerCount": len(tier_bps), "winners": [], "leaves": []}

    winners = []
    for pos in range(len(tier_bps)):
        r = int.from_bytes(abi_hash([("bytes32", seed), ("uint256", draw_id), ("uint256", pos)]), "big") % total_twab
        c = 0
        for account in accounts:
            c += account["twab"]
            if r < c:
                winners.append(account["address"])
                break

    distribution_id = hx(abi_hash([("address", draw_manager), ("uint256", draw_id)]))
    leaves = []
    leaf_index = 0
    for pos, winner in enumerate(winners):
        for leg in prize_legs:
            floor_sum = sum((leg["amount"] * bps) // 10000 for bps in tier_bps)
            amount = (leg["amount"] * tier_bps[pos]) // 10000
            if pos == 0:
                amount += leg["amount"] - floor_sum
            leaf = hx(abi_hash([
                ("bytes32", LEAF_DOMAIN),
                ("bytes32", distribution_id),
                ("uint256", leaf_index),
                ("address", winner),
                ("address", leg["token"]),
                ("uint256", amount),
            ]))
            leaves.append({"leafIndex": str(leaf_index), "position": pos, "account": winner, "token": leg["token"], "amount": str(amount), "leaf": leaf})
            leaf_index += 1

    return {
        "algoVersion": ALGO_VERSION,
        "root": merkle_root([l["leaf"] for l in leaves]),
        "totalTwab": str(total_twab),
        "totalPayout": str(sum(l["amount"] for l in prize_legs)),
        "winnerCount": len(tier_bps),
        "winners": winners,
        "leaves": leaves,
    }


if __name__ == "__main__":
    with open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin as f:
        print(json.dumps(compute(json.load(f)), indent=2))
