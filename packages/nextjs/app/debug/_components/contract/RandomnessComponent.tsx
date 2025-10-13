"use client";

import { useState, useMemo } from "react";
import { useNetwork } from "@starknet-react/core";
import { useAccount } from "~~/hooks/useAccount";
import { useTransactor } from "~~/hooks/scaffold-stark/useTransactor";
import { useTargetNetwork } from "~~/hooks/scaffold-stark/useTargetNetwork";
import { notification } from "~~/utils/scaffold-stark";
import { ContractName } from "~~/utils/scaffold-stark/contract";
import { Address } from "~~/components/scaffold-stark";
import { Address as AddressType } from "@starknet-react/chains";
import { Call, CallData, num } from "starknet";

// Dirección del VRF provider de Cartridge en testnet
// Esta dirección debe ser actualizada con la dirección real proporcionada por Cartridge
const VRF_PROVIDER_ADDRESS =
  "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";

// Dirección esperada del contrato de Randomness desplegado en testnet
// Esta dirección se actualiza con cada nuevo deployment para pruebas
const EXPECTED_RANDOMNESS_CONTRACT_ADDRESS =
  "0x2e91ef979c67ef901846fed17a9d72c9c745536266d01962339076bd7717714";

interface RandomnessComponentProps {
  contractName: ContractName;
  contractAddress: AddressType;
  onSuccess?: (txHash: string, generationId: string) => void;
}


export const RandomnessComponent = ({
  contractName,
  contractAddress,
  onSuccess,
}: RandomnessComponentProps) => {
  const [seed, setSeed] = useState<string>("12345");
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");
  const [generationId, setGenerationId] = useState<string>("");

  const { status: walletStatus, isConnected, account, chainId } = useAccount();
  const { chain } = useNetwork();
  const { targetNetwork } = useTargetNetwork();

  // Configuración de parámetros por defecto según requerimientos
  const callbackFeeLimit = "100000"; // 100000 wei como límite de callback
  const publishDelay = "0"; // Sin delay de publicación

  // Detectar si estamos en modo desarrollo o producción
  const isDevnet =
    chain?.network === "devnet" || targetNetwork.network === "devnet";

  // Crear instancia del contrato consumidor usando el contrato desplegado
  const { writeTransaction } = useTransactor();

  const writeDisabled = useMemo(
    () =>
      !chain ||
      chain?.network !== targetNetwork.network ||
      walletStatus === "disconnected",
    [chain, targetNetwork.network, walletStatus],
  );

  const handleRequestRandomness = async () => {
    if (!isConnected || writeDisabled) {
      notification.error(
        "Please connect your wallet and make sure you are on the correct network",
      );
      return;
    }

    // Additional verification that the address is valid before proceeding
    if (
      account?.address &&
      (!account.address.startsWith("0x") ||
        account.address.length < 3 ||
        account.address.length > 66)
    ) {
      notification.error(
        "The account address has an invalid format. Try reconnecting your wallet.",
      );
      return;
    }

    if (!account?.address) {
      notification.error(
        "Could not get the connected account address. Try reconnecting your wallet.",
      );
      return;
    }

    if (!seed || isNaN(Number(seed))) {
      notification.error("Please enter a valid seed (integer number)");
      return;
    }

    setIsLoading(true);
    setTxHash("");
    setGenerationId("");

    try {
      // Convertir seed a u64 (número entero sin signo de 64 bits)
      const seedValue = BigInt(seed);

      // TODO: Production mode (request_randomness_prod) is currently disabled due to VRF issues on testnet.
      // For now, we're forcing dev mode (devnet_generate) for all environments including testnet.
      // Once the production VRF integration is stable, uncomment the conditional logic below
      // and remove the forced dev mode implementation.
      
      // TEMPORARY: Always use devnet_generate regardless of network
      const seedHex = num.toHex(seedValue);

      const txHash = await writeTransaction([
        {
          contractAddress: contractAddress as string,
          entrypoint: "devnet_generate",
          calldata: [seedHex],
        },
      ]);

      if (txHash) {
        setTxHash(txHash);
        notification.success(
          `5 random numbers generated successfully! Hash: ${txHash}`,
        );
        if (onSuccess) {
          onSuccess(txHash, generationId);
        }
      }

      /* COMMENTED OUT - Production mode with VRF (to be re-enabled when VRF is stable)
      
      // Detectar si estamos en devnet o testnet/mainnet
      const isDevnet =
        forceDevMode ||
        chain?.network === "devnet" ||
        targetNetwork.network === "devnet";

      if (isDevnet) {
        // For development: use devnet_generate directly

        const seedHex = num.toHex(seedValue);

        const txHash = await writeTransaction([
          {
            contractAddress: contractAddress as string,
            entrypoint: "devnet_generate",
            calldata: [seedHex],
          },
        ]);

        if (txHash) {
          setTxHash(txHash);
          notification.success(
            `5 random numbers generated successfully! Hash: ${txHash}`,
          );
          if (onSuccess) {
            onSuccess(txHash, generationId);
          }
        }
      } else {
        // For production: use correct VRF protocol with multicall
        if (useAlternativeMode) {
          // ALTERNATIVE MODE: Use safer parameters

          // Use more conservative parameters
          const safeCallbackFeeLimit = "50000"; // Lower than the original 100000
          const safePublishDelay = "0";

          const seedHex = num.toHex(seedValue);
          const callbackFeeLimitHex = num.toHex(BigInt(safeCallbackFeeLimit));
          const publishDelayHex = num.toHex(BigInt(safePublishDelay));

          // Create the source for VRF using the seed
          const sourceValue = seedValue;

          // MULTICALL: Two transactions according to correct VRF protocol
          const multicallTx = await writeTransaction([
            // Step 1: Request randomness from VRF provider
            {
              contractAddress: VRF_PROVIDER_ADDRESS,
              entrypoint: "request_random",
              calldata: [
                contractAddress as string, // caller (our contract)
                num.toHex(sourceValue), // source (the seed)
              ],
            },
            // Step 2: Consume randomness in our contract
            {
              contractAddress: contractAddress as string,
              entrypoint: "request_randomness_prod",
              calldata: [seedHex, callbackFeeLimitHex, publishDelayHex],
            },
          ]);

          if (multicallTx) {
            setTxHash(multicallTx);
            notification.success(
              `VRF request sent (Safe Mode)! Hash: ${multicallTx}. Waiting for oracle response...`,
            );
            if (onSuccess) {
              onSuccess(multicallTx, generationId);
            }
          }
        } else {
          // NORMAL MODE: Standard Multicall

          const seedHex = num.toHex(seedValue);
          const callbackFeeLimitHex = num.toHex(BigInt(callbackFeeLimit));
          const publishDelayHex = num.toHex(BigInt(publishDelay));

          // Create the source for VRF using the seed
          const sourceValue = seedValue;

          // MULTICALL: Two transactions according to correct VRF protocol
          const multicallTx = await writeTransaction([
            // Step 1: Request randomness from VRF provider
            {
              contractAddress: VRF_PROVIDER_ADDRESS,
              entrypoint: "request_random",
              calldata: [
                contractAddress as string, // caller (our contract)
                num.toHex(sourceValue), // source (the seed)
              ],
            },
            // Step 2: Consume randomness in our contract
            {
              contractAddress: contractAddress as string,
              entrypoint: "request_randomness_prod",
              calldata: [seedHex, callbackFeeLimitHex, publishDelayHex],
            },
          ]);

          if (multicallTx) {
            setTxHash(multicallTx);
            notification.success(
              `VRF request sent! Hash: ${multicallTx}. Waiting for oracle response...`,
            );
            if (onSuccess) {
              onSuccess(multicallTx, generationId);
            }
          }
        }
      }
      */
    } catch (error: any) {
      // Provide more specific error messages
      let errorMessage = "Unknown error requesting randomness";

      if (
        error.name === "UserRejectedRequestError" ||
        error.message?.includes("User rejected request")
      ) {
        errorMessage = "Transaction canceled by user. Please try again.";
      } else if (error.message?.includes("insufficient")) {
        errorMessage = "Insufficient funds to cover transaction fees";
      } else if (error.message?.includes("nonce")) {
        errorMessage = "Nonce error. Please try again";
      } else if (error.message?.includes("network")) {
        errorMessage = "Network error. Check your connection";
      } else if (error.message?.includes("ENTRYPOINT_NOT_FOUND")) {
        errorMessage = `❌ ENTRYPOINT_NOT_FOUND: Function does not exist in deployed contract.
        Contract address: ${contractAddress}
        Attempted function: ${chain?.network === "devnet" || targetNetwork.network === "devnet" ? "devnet_generate" : "request_randomness_prod"}
        Possible solution: Contract needs to be recompiled and redeployed.`;
      } else if (error.message?.includes("ENTRYPOINT_FAILED")) {
        errorMessage = `❌ ENTRYPOINT_FAILED: Error executing contract function.
        Contract address: ${contractAddress}
        Function: ${chain?.network === "devnet" || targetNetwork.network === "devnet" ? "devnet_generate" : "request_randomness_prod"}
        Possible solution: Verify that the contract is correctly initialized.`;
      } else if (error.message?.includes("argent/multicall-failed")) {
        errorMessage = `❌ ARGENT_MULTICALL_FAILED: Error in VRF multicall.
        Executed transactions:
        1. request_random → VRF Provider (${VRF_PROVIDER_ADDRESS})
        2. request_randomness_prod → Contract (${contractAddress})
        Possible solution: Verify that the VRF coordinator is correctly configured.`;
      } else if (error.message) {
        errorMessage = `❌ Specific error: ${error.message}`;
      }

      notification.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Verify that we have all necessary information
  if (!contractAddress || !account?.address) {
    return (
      <div className="space-y-6 p-6 bg-component border border-[#8A45FC] rounded-[5px]">
        <div className="text-center text-gray-400">
          <p>Loading contract information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 bg-component border border-[#8A45FC] rounded-[5px]">
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-white">
          🎲 Generate Random Numbers (Development Mode)
        </h3>

        <p className="text-sm text-gray-300">
          Genera 5 números aleatorios únicos en el rango [1,40] usando la función de desarrollo <code className="bg-base-100 px-2 py-1 rounded">devnet_generate</code>.
        </p>
        
        <div className="bg-blue-900/20 p-3 rounded-lg border border-blue-600">
          <p className="text-blue-300 text-sm">
            ℹ️ <strong>Nota:</strong> El modo de producción con VRF está temporalmente deshabilitado. Por ahora, se usa generación local para pruebas.
          </p>
        </div>

        {/* Contract information */}
        <div className="bg-base-100 p-4 rounded-lg">
          <h4 className="font-semibold mb-2">Contrato Randomness:</h4>
          <Address address={contractAddress} />
          <div className="mt-2 text-xs text-gray-400 space-y-1">
            <p>
              <strong>Red:</strong> {targetNetwork.name}
            </p>
            <p>
              <strong>Función:</strong> <code className="bg-base-300 px-1 rounded">devnet_generate(seed)</code>
            </p>
          </div>
        </div>

        {/* Input form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Seed (integer number):
            </label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="12345"
              className="input input-bordered w-full bg-base-100 text-white"
              disabled={isLoading}
            />
            <p className="text-xs text-gray-400 mt-1">
              The seed determines the random sequence. Use different values to
              get different results.
            </p>
          </div>

          {/* Connection status */}
          {!isConnected && (
            <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
              <p className="text-red-300 text-sm">
                ⚠️ Wallet not connected. Connect your wallet to use this
                function.
              </p>
            </div>
          )}

          {/* Network status */}
          {isConnected && writeDisabled && (
            <div className="bg-yellow-900/20 p-3 rounded-lg border border-yellow-600">
              <p className="text-yellow-300 text-sm">
                ⚠️ Wallet connected to wrong network. Switch to{" "}
                {targetNetwork.name}.
              </p>
            </div>
          )}

          {/* Potential problems diagnosis */}
          {contractAddress &&
            contractAddress.toLowerCase().replace(/^0x0+/, "0x") !==
              EXPECTED_RANDOMNESS_CONTRACT_ADDRESS.toLowerCase().replace(
                /^0x0+/,
                "0x",
              ) && (
              <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
                <h4 className="font-semibold text-red-300 mb-2">
                  🚨 Problem Detected
                </h4>
                <div className="text-sm space-y-1 text-red-200">
                  <p>
                    <strong>Incorrect contract address:</strong>
                  </p>
                  <p>
                    • Expected address: {EXPECTED_RANDOMNESS_CONTRACT_ADDRESS}
                  </p>
                  <p>• Current address: {contractAddress}</p>
                  <p>
                    • <strong>Solution:</strong> The contract needs to be
                    recompiled and redeployed with the correct address.
                  </p>
                </div>
              </div>
            )}



          {/* Transaction result */}
          {txHash && (
            <div className="bg-green-900/20 p-3 rounded-lg border border-green-600">
              <p className="text-green-300 text-sm break-words">
                Transaction hash: {txHash}
              </p>
            </div>
          )}

          {/* Main button */}
          <button
            className={`btn w-full ${
              isLoading || !isConnected || writeDisabled
                ? "btn-disabled"
                : "bg-gradient-dark hover:bg-gradient-dark/80"
            }`}
            onClick={handleRequestRandomness}
            disabled={isLoading || !isConnected || writeDisabled}
          >
            {isLoading && (
              <span className="loading loading-spinner loading-sm mr-2"></span>
            )}
            🎲 Generar 5 Números Aleatorios
          </button>
        </div>

        {/* Additional information */}
        <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-600">
          <h4 className="font-semibold mb-2 text-blue-300">💡 Cómo funciona:</h4>
          <ol className="text-sm space-y-1 text-gray-300">
            <li>
              1. Llama directamente a <code className="bg-base-100 px-1 rounded">devnet_generate(seed)</code>
            </li>
            <li>
              2. El contrato genera 5 números únicos usando un algoritmo LCG local
            </li>
            <li>
              3. Los números se generan inmediatamente sin depender de oráculos externos
            </li>
            <li>
              4. Los números se almacenan y pueden consultarse con{" "}
              <code className="bg-base-100 px-1 rounded">get_generation_numbers(id)</code>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
