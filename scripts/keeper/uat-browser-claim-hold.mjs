import fs from "node:fs";
import path from "node:path";

export class UatBrowserClaimHold {
  constructor({ armedManager, chainId, drawManagerAddress, claimManagerAddress, file }) {
    this.enabled = Boolean(armedManager);
    if (!this.enabled) return;
    const address = (value) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(value || "")) throw new Error("Invalid browser-claim hold address");
      return value.toLowerCase();
    };
    if (BigInt(chainId) !== 10143n) throw new Error("Browser-claim hold is testnet-only");
    this.manager = address(drawManagerAddress);
    this.claimManager = address(claimManagerAddress);
    if (address(armedManager) !== this.manager) throw new Error("Browser-claim hold manager mismatch");
    if (!file) throw new Error("Browser-claim hold requires persistent file");
    this.file = file;
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (state.version !== 1 || state.chainId !== 10143 || state.manager !== this.manager
          || state.claimManager !== this.claimManager || !/^[1-9][0-9]*$/.test(state.drawId)) {
        throw new Error("Browser-claim hold checkpoint mismatch");
      }
      this.state = state;
    }
  }

  // Called only after parity/proof reconstruction identifies at least one unpaid leaf.
  hold(drawId) {
    if (!this.enabled) return false;
    const id = BigInt(drawId).toString();
    if (BigInt(id) <= 0n) throw new Error("Invalid browser-claim hold draw");
    if (!this.state) {
      const state = { version: 1, chainId: 10143, manager: this.manager,
        claimManager: this.claimManager, drawId: id, selectedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
      fs.renameSync(tmp, this.file);
      this.state = state;
    }
    return this.state.drawId === id;
  }
}