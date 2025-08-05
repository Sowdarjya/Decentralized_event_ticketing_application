use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::time;
use ic_cdk_macros::{query, update};
use ic_stable_structures::memory_manager::{MemoryManager, MemoryId, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, Storable};
use serde::Serialize;
use std::cell::RefCell;
use std::borrow::Cow;

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct User {
    pub id: Principal,
    pub name: String,
    pub email: String,
    pub tickets_purchased: u64,
    pub is_organizer: bool,
    pub created_at: u64,
}

type Memory = VirtualMemory<DefaultMemoryImpl>;

const USERS_MEMORY_ID: MemoryId = MemoryId::new(0);

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = 
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static USERS: RefCell<StableBTreeMap<Principal, User, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(USERS_MEMORY_ID))
        )
    );
}

impl Storable for User {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).unwrap()
    }

    fn into_bytes(self) -> Vec<u8> {
        candid::encode_one(self).unwrap()
    }

    const BOUND: ic_stable_structures::storable::Bound = ic_stable_structures::storable::Bound::Unbounded;
}

#[ic_cdk::query]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}

#[ic_cdk::update]
fn create_user(name: String, email: String, is_organizer: bool) -> Result<User, String> {
    let caller = ic_cdk::caller();
    let now = time();

    if name.is_empty() || email.is_empty() {
        return Err("Name and email cannot be empty".to_string());
    }

    if USERS.with(|users| {
        users.borrow().contains_key(&caller)
    }) {
        return Err("User already exists".to_string());
    }

    let email_taken = USERS.with(|users| {
        users.borrow().iter().any(|entry| entry.value().email == email)
    });

    if email_taken {
        return Err("Email already taken".to_string());
    }

    let user = User {
        id: caller,
        name,
        email,
        tickets_purchased: 0,
        is_organizer,
        created_at: now,
    };

    USERS.with(|users| {
        users.borrow_mut().insert(caller, user.clone());
    });

    Ok(user)
}

// Export candid
ic_cdk::export_candid!();