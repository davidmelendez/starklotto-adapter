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
  "0x5b3558ec6cbe58d1d1279b428aaace0fd9230b5993e19f482af82306076c54f";

interface RandomnessComponentProps {
  contractName: ContractName;
  contractAddress: AddressType;
  onSuccess?: (txHash: string, generationId: string) => void;
}

interface VRFCoordinatorConfigProps {
  contractAddress: AddressType;
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
  const [useAlternativeMode, setUseAlternativeMode] = useState<boolean>(false);
  const [forceDevMode, setForceDevMode] = useState<boolean>(false);

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

    // 🚨 SPECIFIC VERIFICATION: Detect problematic account
    if (
      account?.address ===
      "0x0297fd6c19289a017d50b1b65a07ea4db27596a8fade85c6b9622a3f9a24d2a9"
    ) {
      notification.error(
        "A problematic account has been detected. Try reconnecting your wallet or use a different account.",
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
          🏆 Multicall VRF - Request Randomness with Cartridge
        </h3>

        <p className="text-sm text-gray-300">
          {isDevnet ? (
            <>
              This function generates 5 unique random numbers in the range
              [1,40] using local generation for development.
            </>
          ) : (
            <>
              This function executes a multicall that first requests randomness
              from the Cartridge VRF provider, then consumes that randomness to
              generate 5 unique numbers in the range [1,40].
            </>
          )}
        </p>

        {/* Contract information */}
        <div className="bg-base-100 p-4 rounded-lg">
          <h4 className="font-semibold mb-2">Consumer Contract:</h4>
          <Address address={contractAddress} />
          <div className="mt-2 text-xs text-gray-400">
            <p>
              <strong>Expected address:</strong>{" "}
              {EXPECTED_RANDOMNESS_CONTRACT_ADDRESS}
            </p>
            <p>
              <strong>Current address:</strong> {contractAddress}
            </p>
            <p>
              <strong>Network:</strong> {chain?.name || "Unknown"} →{" "}
              {targetNetwork.name}
            </p>
            <p>
              <strong>Mode:</strong>{" "}
              {isDevnet
                ? "Development (devnet)"
                : "Production (testnet/sepolia)"}
            </p>
          </div>
        </div>

        {/* Technical information */}
        <div
          className={`${isDevnet ? "bg-blue-900/20 border-blue-600" : forceDevMode ? "bg-yellow-900/20 border-yellow-600" : "bg-purple-900/20 border-purple-600"} p-4 rounded-lg`}
        >
          <h4
            className={`font-semibold mb-2 ${isDevnet ? "text-blue-300" : forceDevMode ? "text-yellow-300" : "text-purple-300"}`}
          >
            📋 Mode:{" "}
            {isDevnet
              ? forceDevMode
                ? "Forced Development (devnet_generate)"
                : "Development (Local)"
              : useAlternativeMode
                ? "Production (Safe Multicall)"
                : "Production (Standard Multicall)"}
          </h4>
          <div className="space-y-1 text-sm">
            {isDevnet ? (
              <>
                <p>
                  <strong>Method:</strong> devnet_generate (local generation)
                </p>
                <p>
                  <strong>Contract:</strong> {contractAddress}
                </p>
                <p>
                  <strong>Status:</strong>{" "}
                  {forceDevMode ? "Forced for testing" : "Automatic"}
                </p>
              </>
            ) : (
              <>
                <p>
                  <strong>Method:</strong> Multicall VRF (
                  {useAlternativeMode ? "Safe Mode" : "Standard"})
                </p>
                <p>
                  <strong>Transaction 1:</strong> request_random → VRF Provider
                </p>
                <p>
                  <strong>Transaction 2:</strong> request_randomness_prod →
                  Contract
                </p>
                <p>
                  <strong>VRF Provider:</strong> {VRF_PROVIDER_ADDRESS}
                </p>
                <p>
                  <strong>Callback Fee Limit:</strong>{" "}
                  {useAlternativeMode ? "50,000" : callbackFeeLimit} wei
                </p>
                <p>
                  <strong>Publish Delay:</strong> {publishDelay} (no delay)
                </p>
                <p>
                  <strong>Source (Seed):</strong> Used as source for VRF
                </p>
              </>
            )}
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

          {/* Specific account/wallet problem diagnosis */}
          {account?.address &&
            account.address.startsWith(
              "0x0297fd6c19289a017d50b1b65a07ea4db27596a8fade85c6b9622a3f9a24d2a9",
            ) && (
              <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
                <h4 className="font-semibold text-red-300 mb-2">
                  🚨 Problematic Account Detected
                </h4>
                <div className="text-sm space-y-2 text-red-200">
                  <p>
                    <strong>
                      An account that causes transaction errors has been
                      detected.
                    </strong>
                  </p>
                  <div className="bg-red-800/30 p-2 rounded text-xs">
                    <p>
                      <strong>Problematic address:</strong>
                    </p>
                    <p className="font-mono break-all">{account.address}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold">🔧 Options to fix:</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                      <button
                        className="btn btn-sm bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => {
                          // Force disconnect and reconnect
                          window.location.reload();
                        }}
                      >
                        🔄 Reconnect Wallet
                      </button>

                      <button
                        className="btn btn-sm bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => {
                          setUseAlternativeMode(true);
                          setSeed("12345");
                          notification.info(
                            "Safe Mode activated. Try generating numbers with more conservative parameters.",
                          );
                        }}
                      >
                        🛡️ Safe Mode
                      </button>

                      <button
                        className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => {
                          // Generate completely different seed
                          const newSeed = Math.floor(
                            Math.random() * 1000000,
                          ).toString();
                          setSeed(newSeed);
                          notification.info(
                            `New seed generated: ${newSeed}. Try generating numbers with this different seed.`,
                          );
                        }}
                      >
                        🎲 New Seed
                      </button>

                      <button
                        className="btn btn-sm bg-yellow-600 hover:bg-yellow-700 text-white"
                        onClick={() => {
                          setForceDevMode(!forceDevMode);
                          setUseAlternativeMode(false);
                          notification.info(
                            forceDevMode
                              ? "Development mode deactivated."
                              : "Forced development mode activated.",
                          );
                        }}
                      >
                        🔧 {forceDevMode ? "Deactivate" : "Force"} Dev Mode
                      </button>
                    </div>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-red-300 hover:text-red-200">
                        More advanced options
                      </summary>
                      <div className="mt-2 space-y-1 text-red-300">
                        <p>• Use a different account in your wallet</p>
                        <p>• Verify that you have enough ETH for fees</p>
                        <p>• Make sure the account is active</p>
                        <p>• Contact support if the problem persists</p>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )}

          {/* Information about Safe Mode when active */}
          {useAlternativeMode && (
            <div className="bg-green-900/20 p-3 rounded-lg border border-green-600">
              <h4 className="font-semibold text-green-300 mb-2">
                ✅ Safe Mode Active
              </h4>
              <div className="text-sm space-y-1 text-green-200">
                <p>• Using more conservative parameters (fee limit: 50,000)</p>
                <p>• Higher probability of success with problematic accounts</p>
                <p>• You can generate numbers using the main button</p>
                <button
                  className="btn btn-xs bg-red-600 hover:bg-red-700 text-white mt-2"
                  onClick={() => {
                    setUseAlternativeMode(false);
                    notification.info(
                      "Safe Mode deactivated. Using normal parameters.",
                    );
                  }}
                >
                  ❌ Deactivate Safe Mode
                </button>
              </div>
            </div>
          )}

          {/* Information about Forced Development Mode when active */}
          {forceDevMode && (
            <div className="bg-yellow-900/20 p-3 rounded-lg border border-yellow-600">
              <h4 className="font-semibold text-yellow-300 mb-2">
                ⚠️ Forced Development Mode
              </h4>
              <div className="text-sm space-y-1 text-yellow-200">
                <p>
                  • Using development function (devnet_generate) even on testnet
                </p>
                <p>• Local generation without depending on external oracles</p>
                <p>• Useful for testing when there are VRF problems</p>
                <button
                  className="btn btn-xs bg-red-600 hover:bg-red-700 text-white mt-2"
                  onClick={() => {
                    setForceDevMode(false);
                    notification.info(
                      "Development mode deactivated. Using production mode.",
                    );
                  }}
                >
                  ❌ Deactivate Dev Mode
                </button>
              </div>
            </div>
          )}

          {/* Account status (advanced debugging) */}
          {isConnected && !writeDisabled && !account?.address && (
            <div className="bg-orange-900/20 p-3 rounded-lg border border-orange-600">
              <p className="text-orange-300 text-sm font-semibold mb-2">
                🔍 Account status (debugging):
              </p>
              <div className="text-xs space-y-1">
                <p>
                  <strong>Wallet connected:</strong>{" "}
                  {isConnected ? "Yes" : "No"}
                </p>
                <p>
                  <strong>Account address:</strong>{" "}
                  {account?.address || "Not available"}
                </p>
                <p>
                  <strong>Wallet status:</strong> {walletStatus}
                </p>
                <p>
                  <strong>Current network:</strong> {chain?.name || "Unknown"}
                </p>
                <p>
                  <strong>Target network:</strong> {targetNetwork.name}
                </p>
              </div>
              <p className="text-orange-300 text-xs mt-2">
                💡 If you see this, try reconnecting your wallet or refreshing
                the page.
              </p>
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
            {isDevnet
              ? "🎲 Generate 5 Numbers (Development)"
              : useAlternativeMode
                ? "🔒 Multicall VRF (Safe Mode)"
                : "🔮 Multicall VRF (Standard)"}
          </button>
        </div>

        {/* VRF Coordinator Configuration (production only) */}
        {!isDevnet && (
          <VRFCoordinatorConfig contractAddress={contractAddress} />
        )}

        {/* Additional information */}
        <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-600">
          <h4 className="font-semibold mb-2 text-blue-300">💡 How it works:</h4>
          {isDevnet ? (
            <ol className="text-sm space-y-1 text-gray-300">
              <li>
                1. Directly calls <code>devnet_generate(seed)</code>
              </li>
              <li>
                2. The contract generates 5 unique numbers using a local LCG
                algorithm
              </li>
              <li>
                3. Numbers are generated immediately without depending on
                external oracles
              </li>
              <li>
                4. Numbers are stored and can be queried with{" "}
                <code>get_generation_numbers(id)</code>
              </li>
            </ol>
          ) : (
            <ol className="text-sm space-y-1 text-gray-300">
              <li>
                1. <strong>Step 1:</strong> Executes multicall with 2
                transactions
              </li>
              <li>
                2. <strong>Transaction 1:</strong>{" "}
                <code>request_random(caller, source)</code> → VRF Provider
              </li>
              <li>
                3. <strong>Transaction 2:</strong>{" "}
                <code>request_randomness_prod(seed, fee, delay)</code> →
                Contract
              </li>
              <li>
                4. The contract requests and consumes randomness using Cartridge
                VRF protocol
              </li>
              <li>
                5. Numbers are generated using verifiable decentralized
                randomness
              </li>
              <li>
                6. Numbers are stored and can be queried with{" "}
                <code>get_generation_numbers(id)</code>
              </li>
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};

// Component to configure VRF Coordinator
const VRFCoordinatorConfig = ({
  contractAddress,
}: VRFCoordinatorConfigProps) => {
  const [newCoordinatorAddress, setNewCoordinatorAddress] =
    useState<string>(VRF_PROVIDER_ADDRESS);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const { writeTransaction } = useTransactor();

  const handleUpdateCoordinator = async () => {
    if (
      !newCoordinatorAddress ||
      !newCoordinatorAddress.startsWith("0x") ||
      newCoordinatorAddress.length !== 66
    ) {
      notification.error("Invalid VRF coordinator address");
      return;
    }

    setIsLoading(true);

    try {
      const txHash = await writeTransaction([
        {
          contractAddress: contractAddress as string,
          entrypoint: "set_vrf_coordinator",
          calldata: [newCoordinatorAddress],
        },
      ]);

      if (txHash) {
        notification.success(
          `VRF coordinator updated successfully! Hash: ${txHash}`,
        );
        setIsExpanded(false);
      }
    } catch (error: any) {
      notification.error(
        "Error updating VRF coordinator: " + (error.message || "Unknown error"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-orange-900/20 p-4 rounded-lg border border-orange-600">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-orange-300">⚙️ VRF Configuration</h4>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-orange-300 hover:text-orange-200 text-sm"
        >
          {isExpanded ? "▼" : "▶"} {isExpanded ? "Hide" : "Show"}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            The contract must be configured with the correct VRF coordinator
            address from Cartridge.
          </p>

          <div className="space-y-2">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">
                New VRF Coordinator address:
              </label>
              <input
                type="text"
                value={newCoordinatorAddress}
                onChange={(e) => setNewCoordinatorAddress(e.target.value)}
                placeholder="0x..."
                className="input input-bordered w-full bg-base-100 text-white text-sm"
                disabled={isLoading}
              />
            </div>

            <div className="text-xs text-gray-400 space-y-1">
              <p>
                <strong>Current configured address:</strong>{" "}
                {VRF_PROVIDER_ADDRESS}
              </p>
              <p>
                <strong>Address in form:</strong> {newCoordinatorAddress}
              </p>
              <p>
                <em>
                  Note: Only the contract owner can change this configuration.
                </em>
              </p>
            </div>

            <button
              onClick={handleUpdateCoordinator}
              disabled={
                isLoading || newCoordinatorAddress === VRF_PROVIDER_ADDRESS
              }
              className={`btn btn-sm w-full ${
                isLoading || newCoordinatorAddress === VRF_PROVIDER_ADDRESS
                  ? "btn-disabled"
                  : "bg-orange-600 hover:bg-orange-700"
              }`}
            >
              {isLoading && (
                <span className="loading loading-spinner loading-xs mr-2"></span>
              )}
              Update VRF Coordinator
            </button>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-orange-300 hover:text-orange-200">
              Technical information
            </summary>
            <div className="mt-2 space-y-1 text-gray-400 text-xs">
              <p>
                • This function calls <code>set_vrf_coordinator()</code> on the
                contract
              </p>
              <p>• Only the contract owner can execute this function</p>
              <p>
                • The contract will use this address to validate VRF callbacks
              </p>
              <p>
                • Make sure to use the correct VRF provider address from
                Cartridge
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
