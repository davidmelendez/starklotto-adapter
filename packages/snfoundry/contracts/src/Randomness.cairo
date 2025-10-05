#[starknet::interface]
pub trait IRandomnessLottery<TContractState> {
    fn request_randomness_prod(
        ref self: TContractState,
        seed: u64,
        callback_fee_limit: u128,
        publish_delay: u64,
    ) -> u64;

    fn devnet_generate(ref self: TContractState, seed: u64) -> u64;

    fn get_generation_numbers(self: @TContractState, id: u64) -> Array<u8>;

    fn get_generation_status(self: @TContractState, id: u64) -> u8;

    fn get_generation_timestamps(self: @TContractState, id: u64) -> (u64, u64);

    fn get_latest_id(self: @TContractState) -> u64;
}

#[starknet::contract]
pub mod Randomness {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address,
    };
    use super::IRandomnessLottery;

    // Cartridge VRF dispatcher (según README de cartridge-gg/vrf)
    use cartridge_vrf::IVrfProviderDispatcher;
    use cartridge_vrf::IVrfProviderDispatcherTrait;
    use cartridge_vrf::Source;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // Status codes
    const STATUS_PENDING: u8 = 1_u8;
    const STATUS_COMPLETED: u8 = 2_u8;
    const STATUS_FAILED: u8 = 3_u8;

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        GenerationRequested: GenerationRequested,
        GenerationCompleted: GenerationCompleted,
        GenerationFailed: GenerationFailed,
        TestGeneration: TestGeneration,
    }

    #[derive(Drop, starknet::Event)]
    struct GenerationRequested {
        #[key]
        id: u64,
        requester: ContractAddress,
        timestamp: u64,
        is_test: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct GenerationCompleted {
        #[key]
        id: u64,
        n1: u8,
        n2: u8,
        n3: u8,
        n4: u8,
        n5: u8,
        timestamp: u64,
        is_test: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct GenerationFailed {
        #[key]
        id: u64,
        code: felt252,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct TestGeneration {
        #[key]
        id: u64,
        n1: u8,
        n2: u8,
        n3: u8,
        n4: u8,
        n5: u8,
        timestamp: u64,
    }

    #[storage]
    struct Storage {
        generation_counter: u64,
        completed_counter: u64,
        failed_counter: u64,
        // status: 1 pending, 2 completed, 3 failed
        generation_status: Map<u64, u8>,
        generation_is_test: Map<u64, bool>,
        // timestamps
        requested_at: Map<u64, u64>,
        fulfilled_at: Map<u64, u64>,
        // store 5 numbers by (id, index)
        numbers_by_generation: Map<(u64, u8), u8>,
        // optional correlation with oracle request id
        request_id_by_generation: Map<u64, u64>,
        generation_by_request_id: Map<u64, u64>,
        // config
        vrf_coordinator: ContractAddress,
        dev_mode: bool,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        vrf_coordinator: ContractAddress,
        dev_mode: bool,
    ) {
        self.ownable.initializer(owner);
        self.vrf_coordinator.write(vrf_coordinator);
        self.dev_mode.write(dev_mode);
        self.generation_counter.write(0_u64);
        self.completed_counter.write(0_u64);
        self.failed_counter.write(0_u64);
    }

    #[abi(embed_v0)]
    impl RandomnessImpl of IRandomnessLottery<ContractState> {
        fn request_randomness_prod(
            ref self: ContractState,
            seed: u64,
            callback_fee_limit: u128,
            publish_delay: u64,
        ) -> u64 {
            // anyone can request; adjust to onlyOwner if needed
            let next_id = self.generation_counter.read() + 1_u64;
            self.generation_counter.write(next_id);

            self.generation_status.write(next_id, STATUS_PENDING);
            self.generation_is_test.write(next_id, false);
            self.requested_at.write(next_id, get_block_timestamp());

            // Optional: correlate with a VRF request id (0 if unknown at this point)
            self.request_id_by_generation.write(next_id, 0_u64);

            self.emit(
                GenerationRequested {
                    id: next_id,
                    requester: get_caller_address(),
                    timestamp: get_block_timestamp(),
                    is_test: false,
                },
            );

            // Consumo sincrónico de aleatorio usando Cartridge VRF.
            // El caller debe prefijar la multicall con `request_random(caller, source)`.
            // Aquí consumimos con el MISMO `Source`.
            let vrf_addr = self.vrf_coordinator.read();
            let vrf = IVrfProviderDispatcher { contract_address: vrf_addr };
            let rand_felt: felt252 = vrf.consume_random(Source::Salt(seed.into()));

            // Derivar 5 números en [1,49] a partir del random consumido
            let base_seed: u64 = felt_to_u64(rand_felt);
            let mut nums = derive_five_unique_numbers(base_seed);

            // persistir números
            let n1 = *nums.at(0);
            let n2 = *nums.at(1);
            let n3 = *nums.at(2);
            let n4 = *nums.at(3);
            let n5 = *nums.at(4);

            self.numbers_by_generation.write((next_id, 0_u8), n1);
            self.numbers_by_generation.write((next_id, 1_u8), n2);
            self.numbers_by_generation.write((next_id, 2_u8), n3);
            self.numbers_by_generation.write((next_id, 3_u8), n4);
            self.numbers_by_generation.write((next_id, 4_u8), n5);

            self.generation_status.write(next_id, STATUS_COMPLETED);
            self.fulfilled_at.write(next_id, get_block_timestamp());
            self.completed_counter.write(self.completed_counter.read() + 1_u64);

            self.emit(
                GenerationCompleted {
                    id: next_id,
                    n1: n1,
                    n2: n2,
                    n3: n3,
                    n4: n4,
                    n5: n5,
                    timestamp: get_block_timestamp(),
                    is_test: false,
                },
            );

            next_id
        }

        fn devnet_generate(ref self: ContractState, seed: u64) -> u64 {
            assert(self.dev_mode.read(), 'DEV_DISABLED');

            let next_id = self.generation_counter.read() + 1_u64;
            self.generation_counter.write(next_id);
            self.generation_status.write(next_id, STATUS_PENDING);
            self.generation_is_test.write(next_id, true);
            self.requested_at.write(next_id, get_block_timestamp());

            let mut nums = derive_five_unique_numbers(seed);
            // persist numbers
            let n1 = *nums.at(0);
            let n2 = *nums.at(1);
            let n3 = *nums.at(2);
            let n4 = *nums.at(3);
            let n5 = *nums.at(4);

            self.numbers_by_generation.write((next_id, 0_u8), n1);
            self.numbers_by_generation.write((next_id, 1_u8), n2);
            self.numbers_by_generation.write((next_id, 2_u8), n3);
            self.numbers_by_generation.write((next_id, 3_u8), n4);
            self.numbers_by_generation.write((next_id, 4_u8), n5);

            self.generation_status.write(next_id, STATUS_COMPLETED);
            self.fulfilled_at.write(next_id, get_block_timestamp());
            self.completed_counter.write(self.completed_counter.read() + 1_u64);

            self.emit(
                TestGeneration {
                    id: next_id,
                    n1: n1,
                    n2: n2,
                    n3: n3,
                    n4: n4,
                    n5: n5,
                    timestamp: get_block_timestamp(),
                },
            );

            next_id
        }

        fn get_generation_numbers(self: @ContractState, id: u64) -> Array<u8> {
            let status = self.generation_status.read(id);
            assert(status == STATUS_COMPLETED, 'NOT_COMPLETED');

            let mut arr: Array<u8> = array![];
            arr.append(self.numbers_by_generation.read((id, 0_u8)));
            arr.append(self.numbers_by_generation.read((id, 1_u8)));
            arr.append(self.numbers_by_generation.read((id, 2_u8)));
            arr.append(self.numbers_by_generation.read((id, 3_u8)));
            arr.append(self.numbers_by_generation.read((id, 4_u8)));
            arr
        }

        fn get_generation_status(self: @ContractState, id: u64) -> u8 {
            self.generation_status.read(id)
        }

        fn get_generation_timestamps(self: @ContractState, id: u64) -> (u64, u64) {
            let req = self.requested_at.read(id);
            let ful = self.fulfilled_at.read(id);
            (req, ful)
        }

        fn get_latest_id(self: @ContractState) -> u64 { self.generation_counter.read() }
    }

    // This callback is intended to be called by the VRF coordinator (Cartridge)
    // Adjust the signature if your VRF exposes a different callback interface.
    // Common form inspired by existing VRF oracles:
    //   receive_random_words(requester_address, request_id, random_words, calldata)
    #[external(v0)]
    fn receive_random_words(
        ref self: ContractState,
        requester_address: ContractAddress,
        request_id: u64,
        random_words: Span<felt252>,
        _calldata: Array<felt252>,
    ) {
        // only VRF coordinator can call
        assert(get_caller_address() == self.vrf_coordinator.read(), 'ONLY_COORDINATOR');

        // Map the request to a generation id if previously recorded, else create one ad-hoc.
        let maybe_id = self.generation_by_request_id.read(request_id);
        let mut id = maybe_id;
        if id == 0_u64 {
            // no mapping was set; create a new generation id to store this result
            id = self.generation_counter.read() + 1_u64;
            self.generation_counter.write(id);
            self.generation_status.write(id, STATUS_PENDING);
            self.generation_is_test.write(id, false);
            self.requested_at.write(id, get_block_timestamp());
            self.request_id_by_generation.write(id, request_id);
            self.generation_by_request_id.write(request_id, id);
            self.emit(
                GenerationRequested {
                    id: id,
                    requester: requester_address,
                    timestamp: get_block_timestamp(),
                    is_test: false,
                },
            );
        }

        // Defensive checks
        assert(self.generation_status.read(id) == STATUS_PENDING, 'BAD_STATUS');

        // Derive 5 unique numbers from the random words provided
        let base_seed: u64 = derive_seed_from_words(random_words);
        let mut nums = derive_five_unique_numbers(base_seed);

        // persist numbers
        let n1 = *nums.at(0);
        let n2 = *nums.at(1);
        let n3 = *nums.at(2);
        let n4 = *nums.at(3);
        let n5 = *nums.at(4);

        self.numbers_by_generation.write((id, 0_u8), n1);
        self.numbers_by_generation.write((id, 1_u8), n2);
        self.numbers_by_generation.write((id, 2_u8), n3);
        self.numbers_by_generation.write((id, 3_u8), n4);
        self.numbers_by_generation.write((id, 4_u8), n5);

        self.generation_status.write(id, STATUS_COMPLETED);
        self.fulfilled_at.write(id, get_block_timestamp());
        self.completed_counter.write(self.completed_counter.read() + 1_u64);

        self.emit(
            GenerationCompleted {
                id: id,
                n1: n1,
                n2: n2,
                n3: n3,
                n4: n4,
                n5: n5,
                timestamp: get_block_timestamp(),
                is_test: false,
            },
        );
    }

    #[external(v0)]
    fn mark_generation_failed(ref self: ContractState, id: u64, code: felt252) {
        self.ownable.assert_only_owner();
        let status = self.generation_status.read(id);
        assert(status == STATUS_PENDING, 'BAD_STATUS');
        self.generation_status.write(id, STATUS_FAILED);
        self.fulfilled_at.write(id, get_block_timestamp());
        self.failed_counter.write(self.failed_counter.read() + 1_u64);
        self.emit(GenerationFailed { id: id, code: code, timestamp: get_block_timestamp() });
    }

    // Admin helpers
    #[external(v0)]
    fn set_vrf_coordinator(ref self: ContractState, addr: ContractAddress) {
        self.ownable.assert_only_owner();
        self.vrf_coordinator.write(addr);
    }

    // ===== Helpers =====
    fn felt_to_u64(value: felt252) -> u64 {
        let maybe_u128: Option<u128> = value.try_into();
        match maybe_u128 {
            Option::Some(v_u128) => {
                let mod64_divisor: u128 = 18446744073709551616_u128; // 2^64
                let mod64: u128 = v_u128 % mod64_divisor;
                let out: u64 = mod64.try_into().unwrap();
                out
            },
            Option::None => { 0_u64 },
        }
    }
    fn derive_seed_from_words(words: Span<felt252>) -> u64 {
        if words.len() == 0_usize { return get_block_timestamp(); }
        let w0: felt252 = *words.at(0);
        let maybe_u128: Option<u128> = w0.try_into();
        match maybe_u128 {
            Option::Some(v_u128) => {
                // 2^64 (usar literal directa; compila en u128)
                let mod64_divisor: u128 = 18446744073709551616_u128;
                let mod64: u128 = v_u128 % mod64_divisor;
                let seed_u64: u64 = mod64.try_into().unwrap();
                seed_u64
            },
            Option::None => { get_block_timestamp() },
        }
    }

    fn derive_five_unique_numbers(seed: u64) -> Array<u8> {
        let mut out: Array<u8> = array![];
        let mut state_u128: u128 = seed.into();
        // LCG parameters over 2^64 domain
        let a: u128 = 6364136223846793005_u128; // multiplier
        let c: u128 = 1442695040888963407_u128; // increment
        let modulus: u128 = 18446744073709551616_u128; // 2^64

        while out.len() < 5_usize {
            state_u128 = (state_u128 * a + c) % modulus;
            let state: u64 = state_u128.try_into().unwrap();
            // candidate in [1,49]
            let candidate: u8 = ((state % 49_u64) + 1_u64).try_into().unwrap();
            if !contains_u8(@out, candidate) {
                out.append(candidate);
            }
        };
        out
    }

    fn contains_u8(arr: @Array<u8>, value: u8) -> bool {
        let mut i: usize = 0_usize;
        let mut found: bool = false;
        while i < arr.len() {
            if *arr.at(i) == value { found = true; break; }
            i = i + 1_usize;
        };
        found
    }
}


