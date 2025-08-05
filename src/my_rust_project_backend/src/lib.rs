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

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Event {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub location: String,
    pub date: u64,
    pub organizer: Principal,
    pub total_tickets: u64,
    pub tickets_available: u64,
    pub ticket_price: u64,
    pub is_active: bool,
    pub created_at: u64,
}

type Memory = VirtualMemory<DefaultMemoryImpl>;

const USERS_MEMORY_ID: MemoryId = MemoryId::new(0);
const EVENTS_MEMORY_ID: MemoryId = MemoryId::new(1);

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = 
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static USERS: RefCell<StableBTreeMap<Principal, User, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(USERS_MEMORY_ID))
        )
    );

    static EVENTS: RefCell<StableBTreeMap<u64, Event, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(EVENTS_MEMORY_ID))
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

impl Storable for Event {
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

#[ic_cdk::update]
fn create_event(name: String, description: String, location: String, date: u64, total_tickets: u64, ticket_price: u64) -> Result<Event, String> {
    let caller = ic_cdk::caller();
    let now = time();

    if name.is_empty() || description.is_empty() || location.is_empty() || total_tickets == 0 || ticket_price == 0 {
        return Err("All fields must be filled and total tickets and ticket price must be greater than zero".to_string());
    }

    let check_user_exists = USERS.with(|users| {
        users.borrow().contains_key(&caller)
    });

    if !check_user_exists {
        return Err("User does not exist".to_string());
    }

    let check_is_user_organizer = USERS.with(|users| {
        users.borrow().get(&caller).map_or(false, |user| user.is_organizer)
    });

    if !check_is_user_organizer {
        return Err("Only organizers can create events".to_string());
        
    }

    let event_id = EVENTS.with(|events| {
        events.borrow().len() as u64 + 1
    });

    let event = Event {
        id: event_id,
        name,
        description,
        location,
        date,
        organizer: caller,
        total_tickets,
        tickets_available: total_tickets,
        ticket_price,
        is_active: true,
        created_at: now,
    };

    EVENTS.with(|events| {
        events.borrow_mut().insert(event_id, event.clone());
    });

    Ok(event)
}