use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::time;
use ic_cdk_macros::{init, query, update};
use std::collections::{BTreeMap, HashMap};
use std::cell::RefCell;

// Types and Structs
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Event {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub venue: String,
    pub date: u64, // Unix timestamp
    pub total_tickets: u32,
    pub available_tickets: u32,
    pub price_icp: u64, // Price in e8s (1 ICP = 100,000,000 e8s)
    pub organizer: Principal,
    pub max_tickets_per_user: u32,
    pub sale_start_time: u64,
    pub sale_end_time: u64,
    pub is_active: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Ticket {
    pub id: u64,
    pub event_id: u64,
    pub owner: Principal,
    pub seat_number: String,
    pub purchase_time: u64,
    pub is_used: bool,
    pub verification_code: String,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Purchase {
    pub id: u64,
    pub event_id: u64,
    pub buyer: Principal,
    pub quantity: u32,
    pub total_amount: u64,
    pub purchase_time: u64,
    pub ticket_ids: Vec<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct UserProfile {
    pub user_principal: Principal,
    pub purchases: Vec<u64>,
    pub tickets: Vec<u64>,
    pub reputation_score: u32,
    pub is_verified: bool,
}

// Error types
#[derive(CandidType, Deserialize, Debug)]
pub enum TicketingError {
    EventNotFound,
    InsufficientTickets,
    ExceedsMaxTicketsPerUser,
    SaleNotStarted,
    SaleEnded,
    EventInactive,
    Unauthorized,
    TicketNotFound,
    AlreadyUsed,
    InvalidVerificationCode,
}

// Global state
thread_local! {
    static EVENTS: RefCell<BTreeMap<u64, Event>> = RefCell::new(BTreeMap::new());
    static TICKETS: RefCell<BTreeMap<u64, Ticket>> = RefCell::new(BTreeMap::new());
    static PURCHASES: RefCell<BTreeMap<u64, Purchase>> = RefCell::new(BTreeMap::new());
    static USER_PROFILES: RefCell<BTreeMap<Principal, UserProfile>> = RefCell::new(BTreeMap::new());
    static USER_EVENT_PURCHASES: RefCell<HashMap<(Principal, u64), u32>> = RefCell::new(HashMap::new());
    static EVENT_COUNTER: RefCell<u64> = RefCell::new(0);
    static TICKET_COUNTER: RefCell<u64> = RefCell::new(0);
    static PURCHASE_COUNTER: RefCell<u64> = RefCell::new(0);
}

// Utility functions
fn generate_verification_code(ticket_id: u64, event_id: u64) -> String {
    format!("{:08X}-{:08X}", ticket_id, event_id)
}

fn get_or_create_user_profile(principal: Principal) -> UserProfile {
    USER_PROFILES.with(|profiles| {
        profiles.borrow_mut().entry(principal).or_insert(UserProfile {
            user_principal: principal,
            purchases: Vec::new(),
            tickets: Vec::new(),
            reputation_score: 100,
            is_verified: false,
        }).clone()
    })
}

// Canister methods
#[init]
fn init() {
    ic_cdk::println!("Event Ticketing System initialized");
}

#[update]
fn create_event(
    name: String,
    description: String,
    venue: String,
    date: u64,
    total_tickets: u32,
    price_icp: u64,
    max_tickets_per_user: u32,
    sale_start_time: u64,
    sale_end_time: u64,
) -> Result<u64, TicketingError> {
    let caller = ic_cdk::caller();
    let event_id = EVENT_COUNTER.with(|counter| {
        let mut counter = counter.borrow_mut();
        *counter += 1;
        *counter
    });

    let event = Event {
        id: event_id,
        name,
        description,
        venue,
        date,
        total_tickets,
        available_tickets: total_tickets,
        price_icp,
        organizer: caller,
        max_tickets_per_user,
        sale_start_time,
        sale_end_time,
        is_active: true,
    };

    EVENTS.with(|events| {
        events.borrow_mut().insert(event_id, event);
    });

    Ok(event_id)
}

#[query]
fn get_event(event_id: u64) -> Result<Event, TicketingError> {
    EVENTS.with(|events| {
        events.borrow().get(&event_id)
            .cloned()
            .ok_or(TicketingError::EventNotFound)
    })
}

#[query]
fn get_all_events() -> Vec<Event> {
    EVENTS.with(|events| {
        events.borrow().values().cloned().collect()
    })
}

#[query]
fn get_active_events() -> Vec<Event> {
    let current_time = time();
    EVENTS.with(|events| {
        events.borrow().values()
            .filter(|event| event.is_active && event.sale_end_time > current_time)
            .cloned()
            .collect()
    })
}

#[update]
fn purchase_tickets(event_id: u64, quantity: u32) -> Result<Purchase, TicketingError> {
    let caller = ic_cdk::caller();
    let current_time = time();

    // Get event and validate
    let event = EVENTS.with(|events| {
        events.borrow().get(&event_id)
            .cloned()
            .ok_or(TicketingError::EventNotFound)
    })?;

    if !event.is_active {
        return Err(TicketingError::EventInactive);
    }

    if current_time < event.sale_start_time {
        return Err(TicketingError::SaleNotStarted);
    }

    if current_time > event.sale_end_time {
        return Err(TicketingError::SaleEnded);
    }

    if event.available_tickets < quantity {
        return Err(TicketingError::InsufficientTickets);
    }

    // Check user purchase limits
    let current_user_purchases = USER_EVENT_PURCHASES.with(|purchases| {
        purchases.borrow().get(&(caller, event_id)).copied().unwrap_or(0)
    });

    if current_user_purchases + quantity > event.max_tickets_per_user {
        return Err(TicketingError::ExceedsMaxTicketsPerUser);
    }

    // Create purchase
    let purchase_id = PURCHASE_COUNTER.with(|counter| {
        let mut counter = counter.borrow_mut();
        *counter += 1;
        *counter
    });

    let total_amount = event.price_icp * quantity as u64;
    let mut ticket_ids = Vec::new();

    // Create tickets
    for i in 0..quantity {
        let ticket_id = TICKET_COUNTER.with(|counter| {
            let mut counter = counter.borrow_mut();
            *counter += 1;
            *counter
        });

        let seat_number = format!("SEAT-{}-{}", event_id, ticket_id);
        let verification_code = generate_verification_code(ticket_id, event_id);

        let ticket = Ticket {
            id: ticket_id,
            event_id,
            owner: caller,
            seat_number,
            purchase_time: current_time,
            is_used: false,
            verification_code,
        };

        TICKETS.with(|tickets| {
            tickets.borrow_mut().insert(ticket_id, ticket);
        });

        ticket_ids.push(ticket_id);
    }

    let purchase = Purchase {
        id: purchase_id,
        event_id,
        buyer: caller,
        quantity,
        total_amount,
        purchase_time: current_time,
        ticket_ids: ticket_ids.clone(),
    };

    // Update state
    PURCHASES.with(|purchases| {
        purchases.borrow_mut().insert(purchase_id, purchase.clone());
    });

    EVENTS.with(|events| {
        let mut events = events.borrow_mut();
        if let Some(event) = events.get_mut(&event_id) {
            event.available_tickets -= quantity;
        }
    });

    USER_EVENT_PURCHASES.with(|purchases| {
        let mut purchases = purchases.borrow_mut();
        purchases.insert((caller, event_id), current_user_purchases + quantity);
    });

    // Update user profile
    let mut profile = get_or_create_user_profile(caller);
    profile.purchases.push(purchase_id);
    profile.tickets.extend(ticket_ids);
    
    USER_PROFILES.with(|profiles| {
        profiles.borrow_mut().insert(caller, profile);
    });

    Ok(purchase)
}

#[query]
fn get_user_tickets(user: Principal) -> Vec<Ticket> {
    TICKETS.with(|tickets| {
        tickets.borrow().values()
            .filter(|ticket| ticket.owner == user)
            .cloned()
            .collect()
    })
}

#[query]
fn get_user_purchases(user: Principal) -> Vec<Purchase> {
    PURCHASES.with(|purchases| {
        purchases.borrow().values()
            .filter(|purchase| purchase.buyer == user)
            .cloned()
            .collect()
    })
}

#[query]
fn verify_ticket(ticket_id: u64, verification_code: String) -> Result<Ticket, TicketingError> {
    TICKETS.with(|tickets| {
        let ticket = tickets.borrow().get(&ticket_id)
            .cloned()
            .ok_or(TicketingError::TicketNotFound)?;

        if ticket.verification_code != verification_code {
            return Err(TicketingError::InvalidVerificationCode);
        }

        Ok(ticket)
    })
}

#[update]
fn use_ticket(ticket_id: u64, verification_code: String) -> Result<(), TicketingError> {
    let caller = ic_cdk::caller();
    
    TICKETS.with(|tickets| {
        let mut tickets = tickets.borrow_mut();
        let ticket = tickets.get_mut(&ticket_id)
            .ok_or(TicketingError::TicketNotFound)?;

        if ticket.verification_code != verification_code {
            return Err(TicketingError::InvalidVerificationCode);
        }

        if ticket.is_used {
            return Err(TicketingError::AlreadyUsed);
        }

        // Check if caller is authorized (event organizer or venue staff)
        let event = EVENTS.with(|events| {
            events.borrow().get(&ticket.event_id).cloned()
        }).ok_or(TicketingError::EventNotFound)?;

        if caller != event.organizer {
            return Err(TicketingError::Unauthorized);
        }

        ticket.is_used = true;
        Ok(())
    })
}

#[query]
fn get_event_statistics(event_id: u64) -> Result<(u32, u32, u64), TicketingError> {
    let event = get_event(event_id)?;
    let sold_tickets = event.total_tickets - event.available_tickets;
    let total_revenue = (sold_tickets as u64) * event.price_icp;
    
    Ok((sold_tickets, event.available_tickets, total_revenue))
}

#[update]
fn deactivate_event(event_id: u64) -> Result<(), TicketingError> {
    let caller = ic_cdk::caller();
    
    EVENTS.with(|events| {
        let mut events = events.borrow_mut();
        let event = events.get_mut(&event_id)
            .ok_or(TicketingError::EventNotFound)?;

        if event.organizer != caller {
            return Err(TicketingError::Unauthorized);
        }

        event.is_active = false;
        Ok(())
    })
}

#[query]
fn get_user_profile(user: Principal) -> UserProfile {
    get_or_create_user_profile(user)
}