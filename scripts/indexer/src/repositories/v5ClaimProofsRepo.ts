import type Database from 'better-sqlite3';

export interface V5ClaimProofRow {
  chainId: number;
  vaultAddress: string;
  drawManagerAddress: string;
  claimManagerAddress: string;
  drawId: number;
  distributionId: string;
  leafIndex: number;
  account: string;
  token: string;
  amount: string;
  kind: number;
  leafHash: string;
  proof: string;
  root: string;
  publishedAt: string;
}

export interface V5ClaimProofsRepo {
  publishDraw(rows: V5ClaimProofRow[]): void;
  listWinnerProofs(account: string, vaultAddress: string): V5ClaimProofRow[];
  listWinnerAccounts(drawManagerAddress: string, drawId: number): string[];
}

export function createV5ClaimProofsRepo(db: Database.Database): V5ClaimProofsRepo {
  const insert = db.prepare([
    'INSERT INTO v5_claim_proofs (',
    'chain_id, vault_address, draw_manager_address, claim_manager_address, draw_id,',
    'distribution_id, leaf_index, account, token, amount, kind, leaf_hash, proof, root, published_at',
    ') VALUES (',
    '@chainId, @vaultAddress, @drawManagerAddress, @claimManagerAddress, @drawId,',
    '@distributionId, @leafIndex, @account, @token, @amount, @kind, @leafHash, @proof, @root, @publishedAt',
    ')',
  ].join(' '));
  const existingDraw = db.prepare([
    'SELECT chain_id AS chainId, vault_address AS vaultAddress,',
    'draw_manager_address AS drawManagerAddress, claim_manager_address AS claimManagerAddress,',
    'draw_id AS drawId, distribution_id AS distributionId, leaf_index AS leafIndex,',
    'account, token, amount, kind, leaf_hash AS leafHash, proof, root, published_at AS publishedAt',
    'FROM v5_claim_proofs WHERE claim_manager_address = ? AND distribution_id = ?',
    'ORDER BY leaf_index ASC',
  ].join(' '));
  const listWinnerAccounts = db.prepare([
    'SELECT DISTINCT account FROM v5_claim_proofs',
    'WHERE draw_manager_address = ? AND draw_id = ? AND kind = 0',
    'ORDER BY account ASC',
  ].join(' '));
  const publish = db.transaction((rows: V5ClaimProofRow[]) => {
    if (rows.length === 0) return;
    const existing = existingDraw.all(
      rows[0].claimManagerAddress,
      rows[0].distributionId,
    ) as V5ClaimProofRow[];
    if (existing.length > 0) {
      if (existing.length !== rows.length) throw new Error('Claim-proof publication is immutable');
      for (let i = 0; i < rows.length; i++) {
        const left = { ...existing[i], publishedAt: '' };
        const right = { ...rows[i], publishedAt: '' };
        if (JSON.stringify(left) !== JSON.stringify(right)) {
          throw new Error('Claim-proof publication is immutable');
        }
      }
      return;
    }
    for (const row of rows) insert.run(row);
  });
  const list = db.prepare([
    'SELECT chain_id AS chainId, vault_address AS vaultAddress,',
    'draw_manager_address AS drawManagerAddress, claim_manager_address AS claimManagerAddress,',
    'draw_id AS drawId, distribution_id AS distributionId, leaf_index AS leafIndex,',
    'account, token, amount, kind, leaf_hash AS leafHash, proof, root, published_at AS publishedAt',
    'FROM v5_claim_proofs',
    'WHERE account = ? AND vault_address = ? AND kind = 0',
    'ORDER BY draw_id DESC, leaf_index ASC',
  ].join(' '));

  return {
    publishDraw(rows) {
      publish(rows);
    },
    listWinnerProofs(account, vaultAddress) {
      return list.all(account.toLowerCase(), vaultAddress.toLowerCase()) as V5ClaimProofRow[];
    },
    listWinnerAccounts(drawManagerAddress, drawId) {
      return (listWinnerAccounts.all(drawManagerAddress.toLowerCase(), drawId) as Array<{ account: string }>)
        .map((row) => row.account.toLowerCase());
    },
  };
}
