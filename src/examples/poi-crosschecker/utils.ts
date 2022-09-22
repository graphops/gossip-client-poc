import bs58 from "bs58";
import "colors";
import { ethers } from "ethers";
import { Observer } from "../../observer";

// POI topic configs, can probably be moved into POI message class
export type Attestation = {
  nPOI: string;
  deployment: string;
  blockNumber: number;
  indexerAddress: string;
  stake: bigint;
};

export const defaultModel = "default => 100000;";

export function processAttestations(localnPOIs, nPOIs, targetBlock) {
  const divergedDeployments: string[] = [];
  localnPOIs.forEach((blocks, subgraphDeployment) => {
    if (
      !nPOIs.has(subgraphDeployment) ||
      !nPOIs.get(subgraphDeployment).has(targetBlock)
    ) {
      console.debug(
        `No attestations for ${subgraphDeployment} on block ${targetBlock} at the moment`
      );
      return [];
    }

    const localNPOI = blocks.get(targetBlock);
    const attestations = nPOIs.get(subgraphDeployment).get(targetBlock);

    const topAttestation = sortAttestations(attestations)[0];
    console.log(`📒 Attestation check`.blue, {
      subgraphDeployment,
      block: targetBlock,
      attestations,
      mostStaked: topAttestation.nPOI,
      localNPOI,
    });

    if (topAttestation.nPOI === localNPOI) {
      console.debug(
        `✅ POIs match for subgraphDeployment ${subgraphDeployment} on block ${targetBlock}.`
          .green
      );
    } else {
      //Q: is expensive query definitely the way to go? what if attacker purchase a few of these queries, could it lead to dispute?
      //But I guess they cannot specifically buy as queries go through ISA
      console.warn(
        `❌ POIS do not match, updating cost model to block off incoming queries`
          .red
      );
      // Cost model schema used byte32 representation of the deployment hash
      divergedDeployments.push(
        Buffer.from(bs58.decode(subgraphDeployment))
          .toString("hex")
          .replace("1220", "0x")
      );
    }
  });
  return divergedDeployments;
}

export const printNPOIs = (nPOIs: Map<string, Map<string, Attestation[]>>) => {
  if (nPOIs.size === 0) {
    console.log("😔 State is empty.".blue);
  }
  nPOIs.forEach((blocks, subgraph) => {
    console.debug(`\n📝 Printing nPOIs for subgraph ${subgraph}:`.blue);
    blocks.forEach((attestations, block) => {
      console.log(`🔍  Attestations for block ${block}:`.cyan);
      attestations.forEach((a) => {
        console.log(
          `nPOI: ${a.nPOI}\nSender: ${a.indexerAddress}\nStake:${a.stake}\n`
            .cyan
        );
      });
    });
  });
};

export const sortAttestations = (attestations: Attestation[]) =>
  attestations.sort((a, b) => {
    if (a.stake < b.stake) {
      return 1;
    } else if (a.stake > b.stake) {
      return -1;
    } else {
      return 0;
    }
  });

export const storeAttestations = (nPOIs, attestation) => {
  const deployment = attestation.deployment;
  const blockNum = attestation.blockNumber.toString();
  if (nPOIs.has(deployment)) {
    const blocks = nPOIs.get(attestation.deployment);
    if (blocks.has(blockNum)) {
      const attestations = [...blocks.get(blockNum), attestation];
      blocks.set(blockNum, attestations);
    } else {
      blocks.set(blockNum, [attestation]);
    }
  } else {
    nPOIs.set(deployment, new Map([[blockNum, [attestation]]]));
  }
};

// TODO: Break this up a bit and move the general part back to observer and the specific parts can stay here
export const prepareAttestation = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MessageType: any,
  observer: Observer,
  types: {
    name: string;
    type: string;
  }[]
): Promise<Attestation> => {
  //TODO: extract subgraph and nPOI based on provided typing
  const { radioPayload, nonce, blockNumber, blockHash, signature } = message;
  const { subgraph, nPOI } = JSON.parse(radioPayload);

  // Extrac these to the SDK level
  const hash = ethers.utils._TypedDataEncoder.hash(
    MessageType.domain,
    { GraphcastMessage: types },
    JSON.parse(radioPayload)
  );

  const sender = ethers.utils.recoverAddress(hash, signature).toLowerCase();

  // Message Validity (check registry identity, time, stake, dispute) for which to skip by returning early
  const block = await observer.clientManager.ethClient.buildBlock(
    Number(blockNumber)
  );

  const stake = await observer.radioFilter.messageValidity(
    observer.clientManager.registry,
    sender,
    subgraph,
    Number(nonce),
    blockHash,
    block
  );
  if (stake <= 0) {
    return;
  }

  console.info(
    `\n✅ Valid message!\nSender: ${sender}\nNonce(unix): ${nonce}\nBlock: ${blockNumber}\nSubgraph (ipfs hash): ${subgraph}\nnPOI: ${nPOI}\n\n`
      .green
  );

  // can be built outside or using types
  const attestation: Attestation = {
    nPOI,
    deployment: subgraph,
    blockNumber: Number(blockNumber),
    indexerAddress: sender,
    stake: BigInt(stake),
  };

  return attestation;
};
