import React, { useState, useEffect } from "react";
import { AuthClient } from "@dfinity/auth-client";
import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import {
  Calendar,
  Ticket,
  User,
  LogOut,
  Plus,
  Shield,
  MapPin,
  Clock,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  XCircle,
  Search,
  Eye,
  EyeOff,
  Settings,
  Users,
  DollarSign,
  Activity,
} from "lucide-react";

const CANISTER_ID =
  process.env.CANISTER_ID_MY_RUST_PROJECT_BACKEND ||
  "zeh3m-fiaaa-aaaab-qacda-cai";
const II_URL = `https://identity.ic0.app/#authorize`;

// Complete Candid bindings matching the backend
const idlFactory = ({ IDL }) => {
  const Event = IDL.Record({
    id: IDL.Nat64,
    name: IDL.Text,
    description: IDL.Text,
    venue: IDL.Text,
    date: IDL.Nat64,
    total_tickets: IDL.Nat32,
    available_tickets: IDL.Nat32,
    price_icp: IDL.Nat64,
    organizer: IDL.Principal,
    max_tickets_per_user: IDL.Nat32,
    sale_start_time: IDL.Nat64,
    sale_end_time: IDL.Nat64,
    is_active: IDL.Bool,
  });

  const TicketRec = IDL.Record({
    id: IDL.Nat64,
    event_id: IDL.Nat64,
    owner: IDL.Principal,
    seat_number: IDL.Text,
    purchase_time: IDL.Nat64,
    is_used: IDL.Bool,
    verification_code: IDL.Text,
  });

  const Purchase = IDL.Record({
    id: IDL.Nat64,
    event_id: IDL.Nat64,
    buyer: IDL.Principal,
    quantity: IDL.Nat32,
    total_amount: IDL.Nat64,
    purchase_time: IDL.Nat64,
    ticket_ids: IDL.Vec(IDL.Nat64),
  });

  const UserProfile = IDL.Record({
    user_principal: IDL.Principal,
    purchases: IDL.Vec(IDL.Nat64),
    tickets: IDL.Vec(IDL.Nat64),
    reputation_score: IDL.Nat32,
    is_verified: IDL.Bool,
  });

  const TicketingError = IDL.Variant({
    EventNotFound: IDL.Null,
    InsufficientTickets: IDL.Null,
    ExceedsMaxTicketsPerUser: IDL.Null,
    SaleNotStarted: IDL.Null,
    SaleEnded: IDL.Null,
    EventInactive: IDL.Null,
    Unauthorized: IDL.Null,
    TicketNotFound: IDL.Null,
    AlreadyUsed: IDL.Null,
    InvalidVerificationCode: IDL.Null,
  });

  const ResultEvent = IDL.Variant({
    Ok: Event,
    Err: TicketingError,
  });

  const ResultPurchase = IDL.Variant({
    Ok: Purchase,
    Err: TicketingError,
  });

  const ResultEventId = IDL.Variant({
    Ok: IDL.Nat64,
    Err: TicketingError,
  });

  const ResultTicket = IDL.Variant({
    Ok: TicketRec,
    Err: TicketingError,
  });

  const ResultVoid = IDL.Variant({
    Ok: IDL.Null,
    Err: TicketingError,
  });

  const ResultStats = IDL.Variant({
    Ok: IDL.Tuple(IDL.Nat32, IDL.Nat32, IDL.Nat64),
    Err: TicketingError,
  });

  return IDL.Service({
    get_all_events: IDL.Func([], [IDL.Vec(Event)], ["query"]),
    get_active_events: IDL.Func([], [IDL.Vec(Event)], ["query"]),
    get_event: IDL.Func([IDL.Nat64], [ResultEvent], ["query"]),
    create_event: IDL.Func(
      [
        IDL.Text, // name
        IDL.Text, // description
        IDL.Text, // venue
        IDL.Nat64, // date
        IDL.Nat32, // total_tickets
        IDL.Nat64, // price_icp
        IDL.Nat32, // max_tickets_per_user
        IDL.Nat64, // sale_start_time
        IDL.Nat64, // sale_end_time
      ],
      [ResultEventId],
      []
    ),
    purchase_tickets: IDL.Func([IDL.Nat64, IDL.Nat32], [ResultPurchase], []),
    get_user_tickets: IDL.Func(
      [IDL.Principal],
      [IDL.Vec(TicketRec)],
      ["query"]
    ),
    get_user_purchases: IDL.Func(
      [IDL.Principal],
      [IDL.Vec(Purchase)],
      ["query"]
    ),
    get_user_profile: IDL.Func([IDL.Principal], [UserProfile], ["query"]),
    verify_ticket: IDL.Func([IDL.Nat64, IDL.Text], [ResultTicket], ["query"]),
    use_ticket: IDL.Func([IDL.Nat64, IDL.Text], [ResultVoid], []),
    get_event_statistics: IDL.Func([IDL.Nat64], [ResultStats], ["query"]),
    deactivate_event: IDL.Func([IDL.Nat64], [ResultVoid], []),
  });
};

function App() {
  // Authentication & Core State
  const [authClient, setAuthClient] = useState(null);
  const [backend, setBackend] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [principal, setPrincipal] = useState("");
  const [userProfile, setUserProfile] = useState(null);

  // Data State
  const [events, setEvents] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [eventStats, setEventStats] = useState({});

  // UI State
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [activeTab, setActiveTab] = useState("events"); // events, my-tickets, my-events, verify, admin

  // Form States
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEvent, setNewEvent] = useState({
    name: "",
    description: "",
    venue: "",
    date: "",
    totalTickets: 100,
    price: 100000000, // 1 ICP in e8s
    maxPerUser: 4,
    saleStart: "",
    saleEnd: "",
  });

  // Verification State
  const [verificationForm, setVerificationForm] = useState({
    ticketId: "",
    verificationCode: "",
  });

  // Admin State
  const [selectedEventForAdmin, setSelectedEventForAdmin] = useState("");

  useEffect(() => {
    initAuth();
  }, []);

  const showMessage = (msg, type = "info") => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(""), 5000);
  };

  const createAgent = async (identity) => {
    const agent = new HttpAgent({
      identity,
      host:
        process.env.DFX_NETWORK === "local"
          ? "http://127.0.0.1:4943"
          : undefined,
    });
    if (process.env.DFX_NETWORK === "local") {
      await agent.fetchRootKey();
    }
    return agent;
  };

  const initAuth = async () => {
    try {
      const client = await AuthClient.create();
      setAuthClient(client);
      if (await client.isAuthenticated()) {
        await finishLogin(client.getIdentity());
      }
    } catch (error) {
      console.error("Auth initialization failed:", error);
      showMessage("Authentication initialization failed", "error");
    }
  };

  const login = async () => {
    if (!authClient) return;
    setLoading(true);
    try {
      await authClient.login({
        identityProvider: II_URL,
        onSuccess: async () => {
          await finishLogin(authClient.getIdentity());
          setLoading(false);
        },
        onError: (err) => {
          console.error("Login failed", err);
          showMessage("Login failed", "error");
          setLoading(false);
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      showMessage("Login failed", "error");
      setLoading(false);
    }
  };

  const finishLogin = async (identity) => {
    try {
      setPrincipal(identity.getPrincipal().toString());
      setIsAuthenticated(true);
      const agent = await createAgent(identity);
      const backendActor = Actor.createActor(idlFactory, {
        agent,
        canisterId: CANISTER_ID,
      });
      setBackend(backendActor);
      await loadAllData(backendActor, identity.getPrincipal());
      showMessage("Successfully logged in!", "success");
    } catch (error) {
      console.error("Login completion failed:", error);
      showMessage("Login completion failed", "error");
    }
  };

  const logout = async () => {
    if (authClient) await authClient.logout();
    setIsAuthenticated(false);
    setBackend(null);
    setEvents([]);
    setAllEvents([]);
    setTickets([]);
    setPurchases([]);
    setUserProfile(null);
    setEventStats({});
    setPrincipal("");
    showMessage("Logged out successfully", "success");
  };

  const loadAllData = async (actor, userPrincipal) => {
    try {
      await Promise.all([
        loadEvents(actor),
        loadAllEvents(actor),
        loadTickets(actor, userPrincipal),
        loadPurchases(actor, userPrincipal),
        loadUserProfile(actor, userPrincipal),
      ]);
    } catch (error) {
      console.error("Failed to load data:", error);
      showMessage("Failed to load some data", "error");
    }
  };

  const loadEvents = async (actor) => {
    try {
      const res = await actor.get_active_events();
      setEvents(res);
    } catch (error) {
      console.error("Failed to load events:", error);
      showMessage("Failed to load events", "error");
    }
  };

  const loadAllEvents = async (actor) => {
    try {
      const res = await actor.get_all_events();
      setAllEvents(res);
    } catch (error) {
      console.error("Failed to load all events:", error);
    }
  };

  const loadTickets = async (actor, userPrincipal) => {
    try {
      const res = await actor.get_user_tickets(userPrincipal);
      setTickets(res);
    } catch (error) {
      console.error("Failed to load tickets:", error);
      showMessage("Failed to load tickets", "error");
    }
  };

  const loadPurchases = async (actor, userPrincipal) => {
    try {
      const res = await actor.get_user_purchases(userPrincipal);
      setPurchases(res);
    } catch (error) {
      console.error("Failed to load purchases:", error);
      showMessage("Failed to load purchases", "error");
    }
  };

  const loadUserProfile = async (actor, userPrincipal) => {
    try {
      const res = await actor.get_user_profile(userPrincipal);
      setUserProfile(res);
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  };

  const loadEventStats = async (actor, eventId) => {
    try {
      const result = await actor.get_event_statistics(BigInt(eventId));
      if ("Ok" in result) {
        const [sold, available, revenue] = result.Ok;
        setEventStats((prev) => ({
          ...prev,
          [eventId]: { sold, available, revenue },
        }));
      }
    } catch (error) {
      console.error("Failed to load event stats:", error);
    }
  };

  const handleCreateEvent = async () => {
    if (!backend) return;

    if (
      !newEvent.name ||
      !newEvent.description ||
      !newEvent.venue ||
      !newEvent.date
    ) {
      showMessage("Please fill in all required fields", "error");
      return;
    }

    setLoading(true);
    try {
      const result = await backend.create_event(
        newEvent.name,
        newEvent.description,
        newEvent.venue,
        BigInt(new Date(newEvent.date).getTime() * 1_000_000),
        Number(newEvent.totalTickets),
        BigInt(newEvent.price),
        Number(newEvent.maxPerUser),
        BigInt(
          new Date(newEvent.saleStart || new Date()).getTime() * 1_000_000
        ),
        BigInt(
          new Date(
            newEvent.saleEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          ).getTime() * 1_000_000
        )
      );

      if ("Ok" in result) {
        showMessage(
          `✅ Created event successfully! Event ID: ${result.Ok}`,
          "success"
        );
        setShowCreateForm(false);
        setNewEvent({
          name: "",
          description: "",
          venue: "",
          date: "",
          totalTickets: 100,
          price: 100000000,
          maxPerUser: 4,
          saleStart: "",
          saleEnd: "",
        });
        await loadAllData(backend, authClient.getIdentity().getPrincipal());
      } else {
        showMessage(
          `❌ Failed to create event: ${Object.keys(result.Err)[0]}`,
          "error"
        );
      }
    } catch (e) {
      console.error("Create event error:", e);
      showMessage(`❌ Failed to create event: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const purchase = async (eventId, quantity = 1) => {
    if (!backend) return;
    setLoading(true);
    try {
      const result = await backend.purchase_tickets(BigInt(eventId), quantity);
      if ("Ok" in result) {
        const purchase = result.Ok;
        showMessage(
          `✅ Successfully purchased ${purchase.quantity} ticket(s) for event ${purchase.event_id}!`,
          "success"
        );
        await loadAllData(backend, authClient.getIdentity().getPrincipal());
      } else {
        const errorKey = Object.keys(result.Err)[0];
        showMessage(
          `❌ Purchase failed: ${errorKey.replace(/([A-Z])/g, " $1").trim()}`,
          "error"
        );
      }
    } catch (e) {
      console.error("Purchase error:", e);
      showMessage(`❌ Purchase failed: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const verifyTicket = async () => {
    if (
      !backend ||
      !verificationForm.ticketId ||
      !verificationForm.verificationCode
    ) {
      showMessage("Please enter both ticket ID and verification code", "error");
      return;
    }

    setLoading(true);
    try {
      const result = await backend.verify_ticket(
        BigInt(verificationForm.ticketId),
        verificationForm.verificationCode
      );

      if ("Ok" in result) {
        const ticket = result.Ok;
        showMessage(
          `✅ Ticket verified! Seat: ${ticket.seat_number}, Status: ${
            ticket.is_used ? "Used" : "Valid"
          }`,
          "success"
        );
      } else {
        const errorKey = Object.keys(result.Err)[0];
        showMessage(
          `❌ Verification failed: ${errorKey
            .replace(/([A-Z])/g, " $1")
            .trim()}`,
          "error"
        );
      }
    } catch (e) {
      console.error("Verification error:", e);
      showMessage(`❌ Verification failed: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const useTicket = async (ticketId, verificationCode) => {
    if (!backend) return;
    setLoading(true);
    try {
      const result = await backend.use_ticket(
        BigInt(ticketId),
        verificationCode
      );
      if ("Ok" in result) {
        showMessage("✅ Ticket marked as used successfully!", "success");
        await loadAllData(backend, authClient.getIdentity().getPrincipal());
      } else {
        const errorKey = Object.keys(result.Err)[0];
        showMessage(
          `❌ Failed to use ticket: ${errorKey
            .replace(/([A-Z])/g, " $1")
            .trim()}`,
          "error"
        );
      }
    } catch (e) {
      console.error("Use ticket error:", e);
      showMessage(`❌ Failed to use ticket: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const deactivateEvent = async (eventId) => {
    if (!backend) return;
    setLoading(true);
    try {
      const result = await backend.deactivate_event(BigInt(eventId));
      if ("Ok" in result) {
        showMessage("✅ Event deactivated successfully!", "success");
        await loadAllData(backend, authClient.getIdentity().getPrincipal());
      } else {
        const errorKey = Object.keys(result.Err)[0];
        showMessage(
          `❌ Failed to deactivate event: ${errorKey
            .replace(/([A-Z])/g, " $1")
            .trim()}`,
          "error"
        );
      }
    } catch (e) {
      console.error("Deactivate event error:", e);
      showMessage(`❌ Failed to deactivate event: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const formatICP = (e8s) => {
    return (Number(e8s) / 100_000_000).toFixed(8);
  };

  const formatDate = (nanoTimestamp) => {
    return new Date(Number(nanoTimestamp) / 1_000_000).toLocaleString();
  };

  const getMessageClass = () => {
    switch (messageType) {
      case "success":
        return "bg-green-100 border border-green-200 text-green-800";
      case "error":
        return "bg-red-100 border border-red-200 text-red-800";
      default:
        return "bg-blue-100 border border-blue-200 text-blue-800";
    }
  };

  const myEvents = allEvents.filter(
    (event) => event.organizer.toString() === principal
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <div className="mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ticket className="text-white" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              ICP Event Tickets
            </h1>
            <p className="text-gray-600">
              Secure blockchain-based event ticketing
            </p>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 mb-2">
              <Shield size={16} />
              <span>Fraud Protection Enabled</span>
            </div>
          </div>

          <button
            onClick={login}
            disabled={loading}
            className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:bg-indigo-400 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Connecting...
              </>
            ) : (
              <>
                <User size={18} />
                Login with Internet Identity
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <Ticket className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">
                  ICP Event Tickets
                </h1>
                <p className="text-sm text-gray-600">
                  {userProfile && (
                    <span className="flex items-center gap-2">
                      <span>Reputation: {userProfile.reputation_score}</span>
                      {userProfile.is_verified && (
                        <Shield size={12} className="text-green-600" />
                      )}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Shield size={16} />
                <span>Blockchain Secured</span>
              </div>
              <button
                onClick={logout}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-4 border-b border-gray-200">
            <nav className="flex space-x-8">
              {[
                { id: "events", label: "Browse Events", icon: Calendar },
                { id: "my-tickets", label: "My Tickets", icon: Ticket },
                { id: "my-events", label: "My Events", icon: Settings },
                { id: "verify", label: "Verify Ticket", icon: Shield },
                { id: "admin", label: "Admin", icon: Users },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                    activeTab === id
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Message Display */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${getMessageClass()}`}>
            <div className="flex items-center gap-2">
              {messageType === "error" && <AlertTriangle size={16} />}
              {messageType === "success" && <CheckCircle size={16} />}
              <span>{message}</span>
            </div>
          </div>
        )}

        {/* Browse Events Tab */}
        {activeTab === "events" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Available Events
              </h2>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors"
              >
                <Plus size={18} />
                {showCreateForm ? "Cancel" : "Create Event"}
              </button>
            </div>

            {/* Create Event Form */}
            {showCreateForm && (
              <div className="mb-8 bg-white p-6 rounded-xl shadow-sm border">
                <h3 className="text-lg font-semibold mb-4">Create New Event</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Event Name *"
                    className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newEvent.name}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, name: e.target.value })
                    }
                  />
                  <input
                    type="text"
                    placeholder="Venue *"
                    className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newEvent.venue}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, venue: e.target.value })
                    }
                  />
                  <textarea
                    placeholder="Description *"
                    className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 md:col-span-2"
                    rows="3"
                    value={newEvent.description}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, description: e.target.value })
                    }
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Event Date *
                    </label>
                    <input
                      type="datetime-local"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.date}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, date: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sale Start Date
                    </label>
                    <input
                      type="datetime-local"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.saleStart}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, saleStart: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sale End Date
                    </label>
                    <input
                      type="datetime-local"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.saleEnd}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, saleEnd: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Total Tickets
                    </label>
                    <input
                      type="number"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.totalTickets}
                      onChange={(e) =>
                        setNewEvent({
                          ...newEvent,
                          totalTickets: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Price (e8s units)
                    </label>
                    <input
                      type="number"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.price}
                      onChange={(e) =>
                        setNewEvent({
                          ...newEvent,
                          price: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max per User
                    </label>
                    <input
                      type="number"
                      className="border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                      value={newEvent.maxPerUser}
                      onChange={(e) =>
                        setNewEvent({
                          ...newEvent,
                          maxPerUser: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={handleCreateEvent}
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:bg-indigo-400 flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        Create Event
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Events Grid */}
            {events.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <div
                    key={event.id.toString()}
                    className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow"
                  >
                    <div className="p-6">
                      <h3 className="text-xl font-bold text-gray-800 mb-2">
                        {event.name}
                      </h3>
                      <p className="text-gray-600 mb-4 line-clamp-2">
                        {event.description}
                      </p>

                      <div className="space-y-2 mb-4">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <MapPin size={14} />
                          <span>{event.venue}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar size={14} />
                          <span>{formatDate(event.date)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Ticket size={14} />
                          <span>
                            {event.available_tickets} / {event.total_tickets}{" "}
                            available
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Clock size={14} />
                          <span>
                            Sale ends: {formatDate(event.sale_end_time)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-lg font-bold text-gray-800">
                            {formatICP(event.price_icp)} ICP
                          </span>
                          <div className="text-xs text-gray-500">
                            Max {event.max_tickets_per_user} per user
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <select
                            className="border border-gray-300 rounded px-2 py-1 text-sm"
                            onChange={(e) => {
                              const quantity = parseInt(e.target.value);
                              if (quantity > 0) purchase(event.id, quantity);
                            }}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Qty
                            </option>
                            {[
                              ...Array(
                                Math.min(
                                  event.max_tickets_per_user,
                                  event.available_tickets,
                                  10
                                )
                              ),
                            ].map((_, i) => (
                              <option key={i + 1} value={i + 1}>
                                {i + 1}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => purchase(event.id, 1)}
                            disabled={loading || event.available_tickets === 0}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                              event.available_tickets > 0
                                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                          >
                            {loading
                              ? "..."
                              : event.available_tickets > 0
                              ? "Buy"
                              : "Sold Out"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Calendar size={64} className="text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-gray-600 mb-2">
                  No events available
                </h3>
                <p className="text-gray-500">
                  Create the first event to get started!
                </p>
              </div>
            )}
          </div>
        )}

        {/* My Tickets Tab */}
        {activeTab === "my-tickets" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Your Tickets ({tickets.length})
              </h2>
            </div>

            {tickets.length > 0 ? (
              <div className="space-y-4">
                {tickets.map((ticket) => {
                  const event = allEvents.find(
                    (e) => e.id.toString() === ticket.event_id.toString()
                  );
                  return (
                    <div
                      key={ticket.id.toString()}
                      className="bg-white rounded-xl shadow-sm border p-6"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center ${
                              ticket.is_used ? "bg-red-100" : "bg-green-100"
                            }`}
                          >
                            <Ticket
                              className={
                                ticket.is_used
                                  ? "text-red-600"
                                  : "text-green-600"
                              }
                              size={24}
                            />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">
                              {event?.name ||
                                `Event #${ticket.event_id.toString()}`}
                            </p>
                            <p className="text-sm text-gray-600">
                              Ticket #{ticket.id.toString()}
                            </p>
                            <p className="text-sm text-gray-600">
                              Seat: {ticket.seat_number}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              ticket.is_used
                                ? "bg-red-100 text-red-800"
                                : "bg-green-100 text-green-800"
                            }`}
                          >
                            {ticket.is_used ? "Used" : "Valid"}
                          </span>
                          <p className="text-sm text-gray-600 mt-2">
                            Purchased: {formatDate(ticket.purchase_time)}
                          </p>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Verification Code
                            </label>
                            <div className="flex items-center gap-2">
                              <code className="bg-gray-100 px-3 py-2 rounded text-sm font-mono flex-1">
                                {ticket.verification_code}
                              </code>
                              <button
                                onClick={() =>
                                  navigator.clipboard.writeText(
                                    ticket.verification_code
                                  )
                                }
                                className="p-2 text-gray-600 hover:text-gray-800"
                                title="Copy to clipboard"
                              >
                                📋
                              </button>
                            </div>
                          </div>
                          {event && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Event Details
                              </label>
                              <div className="text-sm text-gray-600 space-y-1">
                                <p>
                                  <MapPin size={12} className="inline mr-1" />
                                  {event.venue}
                                </p>
                                <p>
                                  <Calendar size={12} className="inline mr-1" />
                                  {formatDate(event.date)}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Ticket size={64} className="text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-gray-600 mb-2">
                  No tickets yet
                </h3>
                <p className="text-gray-500 mb-4">
                  Purchase your first ticket from the events tab!
                </p>
              </div>
            )}

            {/* Purchase History */}
            {purchases.length > 0 && (
              <div className="mt-12">
                <h3 className="text-xl font-bold text-gray-800 mb-6">
                  Purchase History
                </h3>
                <div className="space-y-4">
                  {purchases.map((purchase) => {
                    const event = allEvents.find(
                      (e) => e.id.toString() === purchase.event_id.toString()
                    );
                    return (
                      <div
                        key={purchase.id.toString()}
                        className="bg-white rounded-lg shadow-sm border p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-800">
                              {event?.name ||
                                `Event #${purchase.event_id.toString()}`}
                            </p>
                            <p className="text-sm text-gray-600">
                              Purchase #{purchase.id.toString()} •{" "}
                              {purchase.quantity} ticket(s)
                            </p>
                            <p className="text-sm text-gray-600">
                              {formatDate(purchase.purchase_time)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-gray-800">
                              {formatICP(purchase.total_amount)} ICP
                            </p>
                            <p className="text-sm text-gray-600">
                              Tickets: {purchase.ticket_ids.join(", ")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* My Events Tab */}
        {activeTab === "my-events" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Your Events ({myEvents.length})
              </h2>
            </div>

            {myEvents.length > 0 ? (
              <div className="space-y-6">
                {myEvents.map((event) => {
                  const stats = eventStats[event.id.toString()];
                  return (
                    <div
                      key={event.id.toString()}
                      className="bg-white rounded-xl shadow-sm border"
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-xl font-bold text-gray-800">
                              {event.name}
                            </h3>
                            <p className="text-gray-600">{event.description}</p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                              <span>
                                <MapPin size={14} className="inline mr-1" />
                                {event.venue}
                              </span>
                              <span>
                                <Calendar size={14} className="inline mr-1" />
                                {formatDate(event.date)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-medium ${
                                event.is_active
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {event.is_active ? "Active" : "Inactive"}
                            </span>
                            {event.is_active && (
                              <button
                                onClick={() => deactivateEvent(event.id)}
                                disabled={loading}
                                className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors"
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Event Statistics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-gray-800">
                              {event.total_tickets - event.available_tickets}
                            </div>
                            <div className="text-sm text-gray-600">Sold</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-gray-800">
                              {event.available_tickets}
                            </div>
                            <div className="text-sm text-gray-600">
                              Available
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-gray-800">
                              {formatICP(event.price_icp)}
                            </div>
                            <div className="text-sm text-gray-600">
                              Price (ICP)
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-gray-800">
                              {formatICP(
                                BigInt(
                                  event.total_tickets - event.available_tickets
                                ) * event.price_icp
                              )}
                            </div>
                            <div className="text-sm text-gray-600">Revenue</div>
                          </div>
                        </div>

                        {/* Sale Timeline */}
                        <div className="mt-4 text-sm text-gray-600">
                          <div className="flex items-center gap-4">
                            <span>
                              Sale Start: {formatDate(event.sale_start_time)}
                            </span>
                            <span>
                              Sale End: {formatDate(event.sale_end_time)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Settings size={64} className="text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-gray-600 mb-2">
                  No events created yet
                </h3>
                <p className="text-gray-500 mb-4">
                  Create your first event to start selling tickets!
                </p>
                <button
                  onClick={() => setActiveTab("events")}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  Create Event
                </button>
              </div>
            )}
          </div>
        )}

        {/* Verify Ticket Tab */}
        {activeTab === "verify" && (
          <div>
            <div className="max-w-md mx-auto">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
                Verify Ticket
              </h2>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ticket ID
                    </label>
                    <input
                      type="number"
                      placeholder="Enter ticket ID"
                      className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={verificationForm.ticketId}
                      onChange={(e) =>
                        setVerificationForm({
                          ...verificationForm,
                          ticketId: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      placeholder="Enter verification code"
                      className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={verificationForm.verificationCode}
                      onChange={(e) =>
                        setVerificationForm({
                          ...verificationForm,
                          verificationCode: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={verifyTicket}
                      disabled={loading}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:bg-blue-400 flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Eye size={16} />
                          Verify
                        </>
                      )}
                    </button>

                    <button
                      onClick={() =>
                        useTicket(
                          verificationForm.ticketId,
                          verificationForm.verificationCode
                        )
                      }
                      disabled={
                        loading ||
                        !verificationForm.ticketId ||
                        !verificationForm.verificationCode
                      }
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:bg-red-400 flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        "..."
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          Mark Used
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 text-center text-sm text-gray-600">
                <p>Use this tool to verify tickets at event entry.</p>
                <p className="mt-1">
                  Only event organizers can mark tickets as used.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Admin Tab */}
        {activeTab === "admin" && (
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-6">
              Admin Panel
            </h2>

            {/* Event Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Calendar className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-800">
                      {allEvents.length}
                    </p>
                    <p className="text-sm text-gray-600">Total Events</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Ticket className="text-green-600" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-800">
                      {allEvents.reduce(
                        (sum, event) =>
                          sum + (event.total_tickets - event.available_tickets),
                        0
                      )}
                    </p>
                    <p className="text-sm text-gray-600">Tickets Sold</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="text-purple-600" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-800">
                      {formatICP(
                        allEvents.reduce(
                          (sum, event) =>
                            sum +
                            BigInt(
                              event.total_tickets - event.available_tickets
                            ) *
                              event.price_icp,
                          BigInt(0)
                        )
                      )}
                    </p>
                    <p className="text-sm text-gray-600">Total Revenue (ICP)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* All Events Management */}
            <div className="bg-white rounded-xl shadow-sm border">
              <div className="p-6 border-b">
                <h3 className="text-lg font-semibold text-gray-800">
                  All Events Management
                </h3>
              </div>
              <div className="p-6">
                {allEvents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3">Event</th>
                          <th className="text-left p-3">Organizer</th>
                          <th className="text-left p-3">Status</th>
                          <th className="text-left p-3">Tickets</th>
                          <th className="text-left p-3">Revenue</th>
                          <th className="text-left p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allEvents.map((event) => (
                          <tr
                            key={event.id.toString()}
                            className="border-b hover:bg-gray-50"
                          >
                            <td className="p-3">
                              <div>
                                <p className="font-medium">{event.name}</p>
                                <p className="text-gray-600 text-xs">
                                  {event.venue}
                                </p>
                              </div>
                            </td>
                            <td className="p-3">
                              <p className="text-xs font-mono">
                                {event.organizer.toString().slice(0, 10)}...
                              </p>
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  event.is_active
                                    ? "bg-green-100 text-green-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {event.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="p-3">
                              <p>
                                {event.total_tickets - event.available_tickets}{" "}
                                / {event.total_tickets}
                              </p>
                            </td>
                            <td className="p-3">
                              <p>
                                {formatICP(
                                  BigInt(
                                    event.total_tickets -
                                      event.available_tickets
                                  ) * event.price_icp
                                )}
                              </p>
                            </td>
                            <td className="p-3">
                              <button
                                onClick={() =>
                                  loadEventStats(backend, event.id)
                                }
                                className="text-blue-600 hover:text-blue-800 mr-2"
                                title="Load Statistics"
                              >
                                <TrendingUp size={16} />
                              </button>
                              {event.organizer.toString() === principal &&
                                event.is_active && (
                                  <button
                                    onClick={() => deactivateEvent(event.id)}
                                    className="text-red-600 hover:text-red-800"
                                    title="Deactivate Event"
                                  >
                                    <XCircle size={16} />
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-600 text-center py-8">
                    No events found
                  </p>
                )}
              </div>
            </div>

            {/* User Profile Information */}
            {userProfile && (
              <div className="mt-8 bg-white rounded-xl shadow-sm border">
                <div className="p-6 border-b">
                  <h3 className="text-lg font-semibold text-gray-800">
                    Your Profile
                  </h3>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-800">
                        {userProfile.reputation_score}
                      </div>
                      <div className="text-sm text-gray-600">
                        Reputation Score
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-800">
                        {userProfile.purchases.length}
                      </div>
                      <div className="text-sm text-gray-600">
                        Total Purchases
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-800">
                        {userProfile.tickets.length}
                      </div>
                      <div className="text-sm text-gray-600">Total Tickets</div>
                    </div>
                    <div className="text-center">
                      <div
                        className={`text-2xl font-bold ${
                          userProfile.is_verified
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {userProfile.is_verified ? (
                          <Shield size={32} />
                        ) : (
                          <AlertTriangle size={32} />
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        {userProfile.is_verified ? "Verified" : "Not Verified"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
