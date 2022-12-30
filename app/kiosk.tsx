import Image from "next/image";
import { createRef, useEffect, useMemo, useRef, useState } from "react";
import { debounce, divide, isEqual, uniqueId, values } from "lodash";
import { ReactBarcodeReader } from "./scanner";
import BarcodeReader from 'react-barcode-reader'
import CashSelect from "./cashSelect";
import { v4 } from "uuid"
import DiscountMenu from "./discountMenu";
import { ContactInformation, Customer, DiscountValue, Employee, KioskState, Note, Order, Product, ProductPurchase, StrictVariantCategory, VariantInformation } from "./stock-types";
import NotesMenu from "./notesMenu";
import { applyDiscount, findMaxDiscount, fromDbDiscount, isValidVariant, parseDiscount, stringValueToObj } from "./discount_helpers";
import PaymentMethod from "./paymentMethodMenu";
import DispatchMenu from "./dispatchMenu";

export default function Kiosk({ master_state }: { master_state: {
    store_id: string,
    employee: Employee | null,
    store_contact: ContactInformation
} }) {
    const [ kioskState, setKioskState ] = useState<KioskState>({
        customer: null,
        transaction_type: "OUT",
        products: [],
        order_total: null,
        payment: [],
        order_date: null,
        order_notes: null,
        order_history: null,
        salesperson: null,
        till: null
    });

    const [ orderState, setOrderState ] = useState<Order>({
        id: v4(),
        destination: null,
        origin: {
            code: master_state.store_id,
            contact: master_state.store_contact
        },
        products: [],
        status: [],
        status_history: [],
        order_history: [],
        order_notes: [],
        reference: "",
        creation_date: Date.now().toString(),
        discount: "a|0"
    })

    const [ customerState, setCustomerState ] = useState<Customer | null>(null);

    const [ searchType, setSearchType ] = useState<"customer" | "product" | "transaction">("product");
    const [ padState, setPadState ] = useState<"cart" | "select-payment-method" | "await-debit" | "await-cash" | "completed" | "discount" | "note" | "ship-to-customer" | "pickup-from-store">("cart");

    const [ activeProduct, setActiveProduct ] = useState<Product | null>(null);
    const [ activeVariant, setActiveVariant ] = useState<StrictVariantCategory[] | null>(null);
    const [ activeProductVariant, setActiveProductVariant ] = useState<VariantInformation | null>(null);
    const [ activeVariantPossibilities, setActiveVariantPossibilities ] = useState<(StrictVariantCategory[] | null)[] | null>(null);

    const [ searchTermState, setSearchTermState ] = useState("");
    const [ result, setResult ] = useState<Product[] | Customer[] | Order[]>([]);
    const [ searchFocused, setSearchFocused ] = useState(false); 

    const [ discount, setDiscount ] = useState<{
        type: "absolute" | "percentage",
        product: VariantInformation | null,
        value: number,
        for: "cart" | "product",
        exclusive: boolean
    }>({
        type: "absolute",
        for: "product",
        product: null,
        value: 0.00,
        exclusive: false
    })

    const [ currentTransactionPrice, setCurrentTransactionPrice ] = useState<number | null>(null);
    const [ cashContinuable, setCashContinuable ] = useState(false);

    const addToCart = (product: Product, variant: VariantInformation, orderProducts: ProductPurchase[]) => {
        let existing_product = orderProducts.find(k => k.product_code == product.sku && isEqual(k.variant, variant?.variant_code));
        let new_order_products_state = [];

        if(existing_product) {
            // Editing the quantity of an existing product in the order.
            // if(e.product_code == product.sku && isEqual(e.variant, variant?.variant_code)) {
                    // if(findMaxDiscount(e.discount, e.variant_information.retail_price, true) !== findMaxDiscount([ { source: "loyalty", value: fromDbDiscount(variant.loyalty_discount) } ], e.variant_information.retail_price, true)) {
                        // return e;
                    // }else {
                    // }
                // }

            let matching_product = orderProducts.find(e => e.product_code == product.sku && isEqual(e.variant, variant?.variant_code) && (applyDiscount(1, findMaxDiscount(e.discount, e.variant_information.retail_price, false).value) == 1));
            
            if(matching_product) {
                // If a matching product exists; apply emendation
                new_order_products_state = orderProducts.map(e => {
                    return e.product_code == product.sku && isEqual(e.variant, variant?.variant_code) && (applyDiscount(1, findMaxDiscount(e.discount, e.variant_information.retail_price, false).value) == 1) ? { ...e, quantity: e.quantity+1 } : e
                });
            }else {
                let po: ProductPurchase = {
                    id: v4(),
                    product_code: product.sku,
                    variant: variant?.variant_code ?? [],
                    discount: [
                        {
                            source: "loyalty",
                            value: fromDbDiscount(variant.loyalty_discount)
                        }
                    ],
    
                    product_cost: variant?.retail_price ?? 0,
                    quantity: 1,
    
                    product: product,
                    variant_information: variant ?? product.variants[0]
                };
    
                new_order_products_state = [ ...orderProducts, po ]
            }
        }else {
            // Creating a new product in the order.
            let po: ProductPurchase = {
                id: v4(),
                product_code: product.sku,
                variant: variant?.variant_code ?? [],
                discount: [
                    {
                        source: "loyalty",
                        value: fromDbDiscount(variant.loyalty_discount)
                    }
                ],

                product_cost: variant?.retail_price ?? 0,
                quantity: 1,

                product: product,
                variant_information: variant ?? product.variants[0]
            };

            new_order_products_state = [ ...orderProducts, po ]
        }

        if(padState == "cart" && discount.product?.barcode == "CART") {
            setPadState("cart")
            setDiscount({
                type: "absolute",
                for: "cart",
                product: {
                    name: "",
                    stock: [],
                    images: [],
                    /// The group codes for all sub-variants; i.e. is White, Short Sleeve and Small.
                    variant_code: [],
                    order_history: [],
                    /// impl! Implement this type!
                    stock_information: {
                        stock_group: "string",
                        sales_group: 'string',
                        value_stream: 'string',
                        brand: 'string',
                        unit: 'string',
                        tax_code: 'string',
                        weight: 'string',
                        volume: 'string',
                        max_volume: 'string',
                        back_order: false,
                        discontinued: false,
                        non_diminishing: false
                    },
                    loyalty_discount: {
                        Absolute: "0"
                    },
                    barcode: "CART",
                    marginal_price: new_order_products_state?.reduce((prev, curr) => prev += (curr.quantity * curr.variant_information.marginal_price), 0),
                    retail_price: new_order_products_state?.reduce((prev, curr) => prev += (curr.quantity * curr.variant_information.retail_price), 0)
                },
                value: 0,
                exclusive: false
            })
        }

        return new_order_products_state;
    }

    const debouncedResults = useMemo(() => {
        return debounce(async (searchTerm: string, searchType: string) => {
            console.log("Called fetch data! ", searchTerm, searchType);
    
            if(searchTerm == "") {
                setSearchTermState(searchTerm);
                return;
            }
    
            var myHeaders = new Headers();
            myHeaders.append("Cookie", `${document.cookie}`);
    
            setSearchTermState(searchTerm);
    
            const fetchResult = await fetch(`http://127.0.0.1:8000/${searchType}/${searchType == "transaction" ? "ref" : "search"}/${searchTerm}`, {
                method: "GET",
                headers: myHeaders,
                redirect: "follow",
                credentials: "include"
            });
    
            const data: any[] = await fetchResult.json();

            console.log(data, searchType);

            if(data.length == 1 && searchType == "product") {
                let e: Product = data[0];

                let vmap_list = [];
                let active_variant = null;
                let active_product_variant = null;

                for(let i = 0; i < e.variants.length; i++) {
                    let var_map = e.variants[i].variant_code.map(k => {
                        // Replace the variant code with the variant itself.
                        return e.variant_groups.map(c => {
                            let nc = c.variants.map(l => k == l.variant_code ? { category: c.category, variant: l } : false)

                            return nc.filter(l => l)
                        });
                    }).flat();

                    // Flat map of the first variant pair. 
                    let vlist: StrictVariantCategory[] = var_map.map(e => e.length > 0 ? e[0] : false).filter(e => e) as StrictVariantCategory[];

                    if(e.variants[i].barcode == searchTerm) {
                        active_variant = vlist;
                        active_product_variant = e.variants[i];
                    }
                    
                    vmap_list.push(vlist);
                }

                console.log(active_variant);

                if(active_product_variant) {
                    console.log("Active Product Variant:", active_product_variant);

                    let new_pdt_list = addToCart(e, active_product_variant, orderState.products);

                    setOrderState({
                        ...orderState,
                        products: new_pdt_list
                    })
                }else {
                    setActiveProduct(e);
                    setActiveVariantPossibilities(vmap_list);
                    setActiveVariant(active_variant ?? vmap_list[0]);
                    setActiveProductVariant(active_product_variant ?? e.variants[0]);
                }
            }
    
            setResult(data);
        }, 50);
    }, [orderState, discount]);

    const input_ref = createRef<HTMLInputElement>();

    useEffect(() => {
        return () => {
            debouncedResults.cancel();
        };
    });

    return (
        <>
            <ReactBarcodeReader
                onScan={(e: any) => {
                    console.log("Scanned", e);

                    setSearchFocused(false);
                    input_ref.current?.value ? input_ref.current.value = e : {};

                    setSearchType("product");
                    debouncedResults(e, "product");
                }}
                onError={() => {}}
            />

            <div className="flex flex-col justify-between h-[calc(100vh-18px)] min-h-[calc(100vh-18px)] flex-1" onKeyDownCapture={(e) => {
                if(e.key == "Escape") setSearchFocused(false)
            }}>
                <div className="flex flex-col p-4 gap-4">
                    <div className={`flex flex-row items-center p-4 rounded-sm bg-gray-700 gap-4 ${searchFocused ? "border-2 border-blue-500" : "border-2 border-gray-700"}`}>
                        {
                            activeProduct && !searchFocused ?
                            <Image onClick={() => {
                                setActiveProduct(null);
                            }} width="20" height="20" src="/icons/arrow-narrow-left.svg" className="select-none" alt={''} draggable={false} ></Image>
                            :
                            <Image width="20" height="20" src="/icons/search-sm.svg" className="select-none" alt={''} draggable={false}></Image>
                        }

                        <input 
                            ref={input_ref}
                            placeholder={`Search for ${searchType}`} className="bg-transparent focus:outline-none text-white flex-1" 
                            onChange={(e) => {
                                debouncedResults(e.target.value, searchType);
                            }}
                            onFocus={(e) => {
                                setSearchFocused(true)
                                debouncedResults(e.target.value, searchType);
                            }}
                            tabIndex={0}
                            // onBlur={() => setSearchFocused(false)}
                            onKeyDown={(e) => {
                                if(e.key == "Escape") {
                                    e.preventDefault();
                                    setSearchFocused(false)
                                    e.currentTarget.blur()
                                }
                            }}
                            />

                        <div className="flex flex-row items-center gap-2 bg-gray-600 px-1 py-1 rounded-md">
                            <Image draggable={false} onClick={() => { 
                                setResult([]); 
                                setSearchType("product");  

                                input_ref.current?.value ? input_ref.current.value = "" : {};
                                input_ref.current?.focus()
                            }} className="cursor-pointer" width="20" height="20" src="/icons/cube-01-filled.svg" alt={''} style={{ filter: searchType == "product" ? "invert(100%) sepia(0%) saturate(7441%) hue-rotate(38deg) brightness(112%) contrast(111%)" : "invert(58%) sepia(32%) saturate(152%) hue-rotate(176deg) brightness(91%) contrast(87%)" }}></Image>   
                            <Image draggable={false} onClick={() => { 
                                setResult([]); 
                                setSearchType("customer");    

                                input_ref.current?.value ? input_ref.current.value = "" : {};
                                input_ref.current?.focus()
                            }} className="cursor-pointer" width="20" height="20" src="/icons/user-01.svg" alt={''} style={{ filter: searchType == "customer" ? "invert(100%) sepia(0%) saturate(7441%) hue-rotate(38deg) brightness(112%) contrast(111%)" : "invert(58%) sepia(32%) saturate(152%) hue-rotate(176deg) brightness(91%) contrast(87%)" }}></Image>    
                            <Image draggable={false} onClick={() => { 
                                setResult([]); 
                                setSearchType("transaction"); 
                                
                                input_ref.current?.value ? input_ref.current.value = "" : {};
                                input_ref.current?.focus()
                            }} className="cursor-pointer" width="20" height="20" src="/icons/receipt-check-filled.svg" alt={''} style={{ filter: searchType == "transaction" ? "invert(100%) sepia(0%) saturate(7441%) hue-rotate(38deg) brightness(112%) contrast(111%)" : "invert(58%) sepia(32%) saturate(152%) hue-rotate(176deg) brightness(91%) contrast(87%)" }}></Image>    
                        </div>
                        
                        {
                            searchFocused ? 
                            <Image width="20" height="20" src="/icons/x.svg" alt={''} draggable={false} onClick={() => setSearchFocused(false)}></Image>
                            :
                            <Image width="20" height="20" src="/icons/scan.svg" draggable={false} alt={''}></Image>
                        }
                    </div>
                    
                    {
                        searchFocused && (searchTermState !== "") ?
                            <div className="flex flex-1 flex-col flex-wrap gap-2 bg-gray-700 rounded-sm text-white overflow-hidden">
                                {
                                    (() => {
                                        switch(searchType) {
                                            case "product":
                                                return (
                                                    result.length == 0 ?
                                                        <p className="self-center text-gray-400 py-6">No products with this name</p>
                                                        :
                                                        (result as Product[]).map((e: Product, indx) => {
                                                            return (
                                                                <div key={e.sku} className="flex flex-col overflow-hidden h-fit" onClick={() => {
                                                                    setActiveProduct(e);
                                                                    setSearchFocused(false);

                                                                    let vmap_list = [];

                                                                    for(let i = 0; i < e.variants.length; i++) {
                                                                        let var_map = e.variants[i].variant_code.map(k => {
                                                                            // Replace the variant code with the variant itself.
                                                                            return e.variant_groups.map(c => {
                                                                                let nc = c.variants.map(l => k == l.variant_code ? { category: c.category, variant: l } : false)
                        
                                                                                return nc.filter(l => l)
                                                                            });
                                                                        }).flat();
                        
                                                                        // Flat map of the first variant pair. 
                                                                        let vlist: StrictVariantCategory[] = var_map.map(e => e.length > 0 ? e[0] : false).filter(e => e) as StrictVariantCategory[];
                                                                        vmap_list.push(vlist);
                                                                    }

                                                                    setActiveVariantPossibilities(vmap_list);
                                                                    setActiveVariant(vmap_list[0]);
                                                                    setActiveProductVariant(e.variants[0]);
                                                                }}>
                                                                    <div className="grid items-center gap-4 p-4 hover:bg-gray-400 hover:bg-opacity-10 cursor-pointer" style={{ gridTemplateColumns: "50px minmax(200px, 1fr) minmax(300px, 2fr) 225px 75px" }}>
                                                                        <Image height={50} width={50} alt="" src={e.images[0]} className="rounded-sm"></Image>
                                                                        
                                                                        <div className="flex flex-col gap-0 max-w-[26rem] w-full flex-1">
                                                                            <p>{e.name}</p>
                                                                            <p className="text-sm text-gray-400">{e.company}</p>
                                                                        </div>

                                                                        <div className="flex flex-row items-center gap-2 flex-1 flex-wrap">
                                                                            {
                                                                                e.variant_groups.map(e => {
                                                                                    return (
                                                                                        <div key={e.category} className="bg-gray-600 flex flex-row items-center py-1 px-2 rounded-md gap-2 max-h-fit">
                                                                                            <p>{e.category}s </p>

                                                                                            <div className="text-gray-300">
                                                                                                {
                                                                                                    e.variants.map((k, i) => {
                                                                                                        return (i == e.variants.length-1) ? k.name : (k.name+", ")
                                                                                                    })
                                                                                                }
                                                                                            </div>
                                                                                        </div>
                                                                                    )
                                                                                })
                                                                            }
                                                                        </div>

                                                                        <div>
                                                                            {
                                                                                (() => {
                                                                                    let total_stock = e.variants.map(k => {
                                                                                        return k.stock.map(b => {
                                                                                            return b.quantity.quantity_on_hand;
                                                                                        }).reduce(function (prev, curr) {
                                                                                            return prev + curr
                                                                                        }, 0);
                                                                                    }).reduce(function (prev, curr) {
                                                                                        return prev + curr
                                                                                    }, 0);

                                                                                    let total_stock_in_store = e.variants.map(k => {
                                                                                        return k.stock.map(b => {
                                                                                            let total = 0;

                                                                                            if(b.store.code == master_state.store_id) {
                                                                                                total += b.quantity.quantity_on_hand;
                                                                                            }

                                                                                            return total;
                                                                                        }).reduce(function (prev, curr) {
                                                                                            return prev + curr
                                                                                        }, 0);
                                                                                    }).reduce(function (prev, curr) {
                                                                                        return prev + curr
                                                                                    }, 0);

                                                                                    return (
                                                                                        <div className="flex flex-row items-center gap-1">
                                                                                            <p>{total_stock_in_store} instore,</p>
                                                                                            <p className="text-gray-400">{total_stock - total_stock_in_store} in other stores</p>
                                                                                        </div>
                                                                                    )
                                                                                })()
                                                                            }
                                                                        </div>

                                                                        <div className="flex flex-row items-center px-2 font-medium">
                                                                            {
                                                                                (() => {
                                                                                    let flat_map = e.variants.map(k => 
                                                                                        k.retail_price
                                                                                    );
                                                                                    
                                                                                    let min_total = Math.min(...flat_map);
                                                                                    let max_total = Math.max(...flat_map);

                                                                                    if(max_total == min_total) {
                                                                                        return (
                                                                                            <p>${(max_total * 1.15).toFixed(2)}</p>
                                                                                        )
                                                                                    }else {
                                                                                        return (
                                                                                            <p>${(min_total * 1.15).toFixed(2)}-{(max_total * 1.15).toFixed(2)}</p>
                                                                                        )
                                                                                    }
                                                                                })()
                                                                            }
                                                                        </div>
                                                                    </div>

                                                                    {
                                                                        (indx == result.length-1) ? <></> : <hr className="mt-2 border-gray-500" />
                                                                    }
                                                                </div>
                                                            )
                                                        })
                                                )
                                            case "customer":
                                                return (
                                                    result.length == 0 ?
                                                        <p className="self-center text-gray-400 py-6">No customers with this name</p>
                                                        :
                                                        (result as Customer[]).map((e: Customer, indx) => {
                                                            return (
                                                                <div 
                                                                    key={`CUSTOMER-${e.id}`} className="flex flex-col overflow-hidden h-fit"
                                                                    onClick={() => {
                                                                        setCustomerState(e);
                                                                        setSearchFocused(false);
                                                                        setSearchType("product");
                                                                        setResult([]);

                                                                        let new_pdts = orderState.products.map(e => {
                                                                            // If current discount is GREATER than loyalty, keep - otherwise override with loyalty
                                                                            // if(isGreaterDiscount(fromDbDiscount(e.product.loyalty_discount), findMaxDiscount(e.discount, e.variant_information.retail_price), e.variant_information.retail_price)) {
                                                                            //     return e
                                                                            // }else {
                                                                            //     return {
                                                                            //         ...e,
                                                                            //         discount: [{
                                                                            //             source: "",
                                                                            //             value: fromDbDiscount(e.product.loyalty_discount)
                                                                            //         }]
                                                                            //     }
                                                                            // }

                                                                            return {
                                                                                ...e,
                                                                                discount: [
                                                                                    ...e.discount as DiscountValue[],
                                                                                    {
                                                                                        source: "loyalty",
                                                                                        value: fromDbDiscount(e.variant_information.loyalty_discount)
                                                                                    } as DiscountValue
                                                                                ]
                                                                            }
                                                                        });

                                                                        setOrderState({
                                                                            ...orderState,
                                                                            products: new_pdts
                                                                        })

                                                                        input_ref.current?.value ? input_ref.current.value = "" : {};
                                                                    }}
                                                                    >
                                                                    <div className="grid items-center gap-4 p-4 hover:bg-gray-400 hover:bg-opacity-10 cursor-pointer" style={{ gridTemplateColumns: "200px 1fr 100px 150px" }}>
                                                                        <div className="flex flex-col gap-0 max-w-[26rem] w-full flex-1">
                                                                            <p>{e.name}</p>
                                                                            <p className="text-sm text-gray-400">{e.order_history.length} Past Orders</p>
                                                                        </div>

                                                                        <div className="flex flex-row items-center gap-4">
                                                                            <p>({e.contact.mobile.region_code}) {
                                                                                (() => {
                                                                                    let k = e.contact.mobile.root.match(/^(\d{3})(\d{3})(\d{4})$/);
                                                                                    console.log(k, e.contact.mobile.root);

                                                                                    if(!k) return ""
                                                                                    return `${k[1]} ${k[2]} ${k[3]}`
                                                                                })()
                                                                            }</p>
                                                                            <p>{e.contact.email.full}</p>
                                                                        </div>

                                                                        <p className="text-gray-400">${e.balance} Credit</p>

                                                                        <p className="whitespace-nowrap justify-self-end pr-4">Add to cart</p>
                                                                    </div>

                                                                    {
                                                                        (indx == result.length-1) ? <></> : <hr className="mt-2 border-gray-500" />
                                                                    }
                                                                </div>
                                                            )
                                                        })
                                                )
                                            case "transaction":
                                                return (
                                                    result.length == 0 ?
                                                        <p className="self-center text-gray-400 py-6">No transactions with this reference</p>
                                                        :
                                                        (result as Order[]).map((e: Order, indx) => {
                                                            return (
                                                                <div key={`CUSTOMER-${e.id}`} className="flex flex-col overflow-hidden h-fit">
                                                                    <div className="grid items-center gap-4 p-4 hover:bg-gray-400 hover:bg-opacity-10 cursor-pointer" style={{ gridTemplateColumns: "minmax(200px, 1fr) minmax(300px, 2fr) 225px 75px" }}>
                                                                        <div className="flex flex-col gap-0 max-w-[26rem] w-full flex-1">
                                                                            <p>{e.reference} {e.creation_date}</p>
                                                                            {/* <p className="text-sm text-gray-400">{e.order_history.length} Past Orders</p> */}
                                                                        </div>
                                                                    </div>

                                                                    {
                                                                        (indx == result.length-1) ? <></> : <hr className="mt-2 border-gray-500" />
                                                                    }
                                                                </div>
                                                            )
                                                        })
                                                )
                                            default:
                                                return (
                                                    <div>
                                                        A problem has occurred.
                                                    </div>
                                                )
                                        }
                                    })()
                                }
                            </div>
                            :
                            activeProduct ? 
                                <div className="p-4 text-white flex flex-col gap-8  bg-opacity-50 rounded-sm">
                                    <div className="flex flex-row items-start gap-4">
                                        <Image src={activeProductVariant?.images?.[0] ?? activeProduct.images[0]} className="rounded-md" height={150} width={150} alt={activeProduct.name}></Image>

                                        <div className="flex flex-row items-start h-full justify-between flex-1">
                                            <div className="flex flex-col">
                                                <h2 className="text-xl font-medium">{activeProduct.name}</h2>
                                                <p className="text-gray-400">{activeProduct.company}</p>
                                                <br />

                                                <div className="flex flex-row items-center gap-4">
                                                    <p className="text-gray-400">SKU:</p>
                                                    <p>{activeProduct.sku}</p>
                                                </div>
                                                
                                                {/* {(() => {
                                                    if(activeProductVariant?.loyalty_discount.Absolute) {
                                                        return (
                                                            <div className="flex flex-row items-center gap-4">
                                                                <p className="text-gray-400">Loyalty Discount:</p>
                                                                <p>-${activeProductVariant?.loyalty_discount.Absolute}</p>
                                                            </div>
                                                        )
                                                    }else {
                                                        return (
                                                            <div className="flex flex-row items-center gap-4">
                                                                <p className="text-gray-400">Loyalty Discount:</p>
                                                                <p>-%{activeProductVariant?.loyalty_discount.Percentage}</p>
                                                            </div>
                                                        )
                                                    }
                                                })()} */}
                                                <br />
                                                {/* <p className="text-sm text-gray-300 truncate max-w-4">{activeProduct.description.substring(0, 150)+"..."}</p> */}
                                            </div>

                                            <div className="self-center flex flex-row items-center gap-4">
                                                <div 
                                                    className="cursor-pointer flex flex-col justify-between gap-8 bg-[#243a4e] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit"
                                                    onClick={() => {
                                                        if(activeProductVariant) {
                                                            let new_pdt_list = addToCart(activeProduct, activeProductVariant, orderState.products)

                                                            setOrderState({
                                                                ...orderState,
                                                                products: new_pdt_list
                                                            })
                                                        }
                                                    }}
                                                    >
                                                    <Image width="25" height="25" src="/icons/plus-lge.svg" style={{ filter: "invert(70%) sepia(24%) saturate(4431%) hue-rotate(178deg) brightness(86%) contrast(78%)" }} alt={''}></Image>
                                                    <p className="font-medium">Add to cart</p>
                                                </div>

                                                <div className="flex flex-col justify-between gap-8 bg-[#243a4e] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit">
                                                    <Image width="25" height="25" src="/icons/search-sm.svg" style={{ filter: "invert(70%) sepia(24%) saturate(4431%) hue-rotate(178deg) brightness(86%) contrast(78%)" }} alt={''}></Image>
                                                    <p className="font-medium">Show Related Orders</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-row items-start gap-8">
                                        <div className="flex flex-col gap-8">
                                            <div className="flex flex-col gap-4">
                                                {
                                                    activeProduct.variant_groups.map(e => {
                                                        return (
                                                            <div className="flex flex-col gap-2" key={e.category}>
                                                                <p className="text-sm text-gray-400">{e.category.toLocaleUpperCase()}</p>
                                                                <div className="flex flex-row items-center gap-2 select-none">
                                                                    {
                                                                        e.variants.map(k => {
                                                                            let match = activeVariant?.find(function(o) {
                                                                                return o.variant.variant_code == k.variant_code;
                                                                            });

                                                                            let new_vlist: StrictVariantCategory[] = [];

                                                                            activeVariant?.map(j => {
                                                                                if(j.category == e.category) {
                                                                                    new_vlist.push({
                                                                                        category: j.category,
                                                                                        variant: k
                                                                                    })
                                                                                }else {
                                                                                    new_vlist.push(j)
                                                                                }
                                                                            })

                                                                            let variant = activeProduct.variants?.find(b => {
                                                                                let flat = b.variant_code;
                                                                                let f2 = new_vlist?.map(e => e.variant.variant_code);
                        
                                                                                return isEqual(flat, f2)
                                                                            });

                                                                            if(!variant) {
                                                                                return (
                                                                                    <p 
                                                                                        className="bg-gray-700 whitespace-nowrap cursor-pointer text-gray-600 py-1 px-4 w-fit rounded-md" 
                                                                                        key={k.variant_code}
                                                                                        onClick={() => {
                                                                                            let valid_variant: null | StrictVariantCategory[] = null;

                                                                                            for(let i = 0; i < (activeVariantPossibilities?.length ?? 0); i++) {
                                                                                                let new_vlist: StrictVariantCategory[] = [];

                                                                                                activeVariantPossibilities?.[i]?.map(j => {
                                                                                                    if(j.category == e.category) {
                                                                                                        new_vlist.push({
                                                                                                            category: j.category,
                                                                                                            variant: k
                                                                                                        })
                                                                                                    }else {
                                                                                                        // If valid pair, choose. 
                                                                                                        new_vlist.push(j)
                                                                                                    }
                                                                                                })
                                                                                                
                                                                                                if(isValidVariant(activeProduct, new_vlist)) {
                                                                                                    valid_variant = new_vlist;
                                                                                                    break;
                                                                                                }
                                                                                            }

                                                                                            setActiveVariant(valid_variant);
                                                                                        }}>
                                                                                            {k.name}
                                                                                    </p>
                                                                                )
                                                                            }

                                                                            if(match) {
                                                                                return (
                                                                                    <p className="bg-gray-600 whitespace-nowrap cursor-pointer text-white py-1 px-4 w-fit rounded-md" key={k.variant_code}>{k.name}</p>
                                                                                )
                                                                            }
                                                                            else {
                                                                                return (
                                                                                    <p onClick={() => {
                                                                                            let new_vlist: StrictVariantCategory[] = [];

                                                                                            activeVariant?.map(j => {
                                                                                                if(j.category == e.category) {
                                                                                                    new_vlist.push({
                                                                                                        category: j.category,
                                                                                                        variant: k
                                                                                                    })
                                                                                                }else {
                                                                                                    new_vlist.push(j)
                                                                                                }
                                                                                            })
                                                                                            
                                                                                            setActiveVariant(new_vlist)
                                                                                        }} className="bg-gray-600 whitespace-nowrap hover:cursor-pointer text-gray-500 hover:text-gray-400 py-1 px-4 w-fit rounded-md" key={k.variant_code}>{k.name}</p>
                                                                                )
                                                                            }
                                                                        })
                                                                    }
                                                                </div>
                                                            </div>
                                                        )
                                                    })
                                                }
                                            </div>
                                            
                                            <div className="flex flex-col items-start gap-2 w-fit">
                                                <p className="text-sm text-gray-400">COST</p>
                                                {/* As the price of a product is generated by the marginal increase from every variant, we must sum each variants prices to obtain the cost of the product with all variant codes applied. */}
                                                {(() => {
                                                    let variant = activeProduct.variants?.find(b => {
                                                        let flat = b.variant_code;
                                                        let f2 = activeVariant?.map(e => e.variant.variant_code);

                                                        return isEqual(flat, f2)
                                                    });

                                                    return (
                                                        <div>
                                                            <p className="text-2xl font-semibold">${((variant?.retail_price ?? 1) * 1.15).toFixed(2)}</p>
                                                            <p className="text-gray-400">pre-tax: ${((variant?.retail_price ?? 1) * 1).toFixed(2)}</p>
                                                        </div>
                                                    )
                                                    })()
                                                }
                                            </div>
                                            
                                            <div className="flex flex-col gap-2">
                                                <p className="text-sm text-gray-400">INVENTORY</p>
                                                <div className="flex flex-col gap-2 w-full bg-gray-700 p-[0.7rem] px-4 rounded-md">
                                                    {
                                                        activeProductVariant?.stock.map(e => {
                                                            return (
                                                                <div key={`STOCK-FOR-${e.store.code}`} className="flex flex-row items-center justify-between gap-2">
                                                                    <p>{e.store.code}</p>
                                                                    <div className="flex-1 h-[2px] rounded-full bg-gray-400 w-full"></div>
                                                                    <p>{e.quantity.quantity_on_hand}</p>
                                                                    <p>(+{e.quantity.quantity_on_order} on order)</p>
                                                                    {/* <p>{e.quantity.quantity_on_floor}</p> */}
                                                                </div>
                                                            )
                                                        })
                                                    }
                                                </div>
                                            </div>
                                        </div>

                                        <div className="w-full flex flex-col gap-2">
                                            <p className="text-sm text-gray-400">ALL VARIANTS</p>

                                            <div className="p-[0.7rem] w-full bg-gray-700 rounded-md gap-2 flex flex-col">
                                                {
                                                    activeProduct.variants.map((e, indx) => {
                                                        let comparative_map = e.variant_code.map(b => {
                                                           return activeVariant?.find(c => c.variant.variant_code == b)
                                                        });

                                                        let filtered = comparative_map.filter(s => !s);
                                                        let active = filtered.length <= 0;

                                                        return (
                                                            <div key={e.variant_code.toString()} >
                                                                <div 
                                                                    onClick={() => {
                                                                        let variant = activeVariantPossibilities?.find(b => {
                                                                            let flat = b?.map(k => k.variant.variant_code);

                                                                            console.log(flat, e.variant_code);

                                                                            return isEqual(flat, e.variant_code)
                                                                        }) as StrictVariantCategory[];

                                                                        // console.log(variant);

                                                                        setActiveVariant(variant);
                                                                        setActiveProductVariant(e);
                                                                    }}
                                                                    className={`grid w-full px-[0.7rem] py-2 rounded-sm cursor-pointer ${active ? "bg-gray-600" : ""}`} style={{ gridTemplateColumns: "1fr 100px 150px 50px" }}>
                                                                    <p className="flex-1 w-full">{e.name}</p>

                                                                    <p className="text-gray-300">{e.stock.find(e => e.store.code == master_state.store_id)?.quantity.quantity_on_hand ?? 0} Here</p>
                                                                    <p className="text-gray-300">
                                                                        {
                                                                            e.stock.map(e => (e.store.code == master_state.store_id) ? 0 : e.quantity.quantity_on_hand).reduce(function (prev, curr) { return prev + curr }, 0)
                                                                        } In other stores
                                                                    </p>
                                                                    <p >${(e.retail_price * 1.15).toFixed(2)}</p>
                                                                </div>

                                                                {
                                                                    (indx == activeProduct.variants.length-1) ? <></> : <hr className="mt-2 border-gray-500" />
                                                                }
                                                            </div>
                                                        )
                                                    })
                                                }
                                            </div>
                                        </div>
                                    </div>

                                    
                                </div>
                            :
                                <div className="flex flex-1 flex-row flex-wrap gap-4 ">
                                    {/* Tiles */}
                                    {
                                        customerState ? 
                                        <div className="flex flex-col justify-between gap-8 bg-[#4c2f2d] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer"
                                            onClick={() => { 
                                                setCustomerState(null)

                                                setOrderState({
                                                    ...orderState,
                                                    products: orderState.products.map(e => {
                                                        return {
                                                            ...e,
                                                            discount: e.discount.filter(e => e.source !== "loyalty")
                                                        }
                                                    })
                                                })
                                            }}
                                        >
                                            <Image width="25" height="25" src="/icons/user-01.svg" style={{ filter: "invert(86%) sepia(34%) saturate(4038%) hue-rotate(295deg) brightness(88%) contrast(86%)" }} alt={''}></Image>
                                            <p className="font-medium select-none">Remove Customer</p>
                                        </div>
                                        :
                                        <div className="flex flex-col justify-between gap-8 bg-[#2f4038] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer" 
                                            onClick={() => { 
                                                setResult([]); 
                                                setSearchType("customer");    

                                                input_ref.current?.value ? input_ref.current.value = "" : {};
                                                input_ref.current?.focus()
                                            }}
                                        >
                                            <Image width="25" height="25" src="/icons/user-01.svg" style={{ filter: "invert(67%) sepia(16%) saturate(975%) hue-rotate(95deg) brightness(93%) contrast(92%)" }} alt={''}></Image>
                                            <p className="font-medium select-none">Select Customer</p>
                                        </div>
                                    }
                                    
                                    <div
                                        onClick={() => {
                                            setPadState("discount")
                                            setDiscount({
                                                type: "absolute",
                                                for: "cart",
                                                product: {
                                                    name: "",
                                                    stock: [],
                                                    images: [],
                                                    /// The group codes for all sub-variants; i.e. is White, Short Sleeve and Small.
                                                    variant_code: [],
                                                    order_history: [],
                                                    /// impl! Implement this type!
                                                    stock_information: {
                                                        stock_group: "string",
                                                        sales_group: 'string',
                                                        value_stream: 'string',
                                                        brand: 'string',
                                                        unit: 'string',
                                                        tax_code: 'string',
                                                        weight: 'string',
                                                        volume: 'string',
                                                        max_volume: 'string',
                                                        back_order: false,
                                                        discontinued: false,
                                                        non_diminishing: false
                                                    },
                                                    loyalty_discount: {
                                                        Absolute: "0"
                                                    },
                                                    barcode: "CART",
                                                    marginal_price: orderState.products?.reduce((prev, curr) => prev += (curr.quantity * curr.variant_information.marginal_price), 0),
                                                    retail_price: orderState.products?.reduce((prev, curr) => prev += (curr.quantity * curr.variant_information.retail_price), 0)
                                                },
                                                value: 0,
                                                exclusive: false
                                            })
                                        }} 
                                        className="flex flex-col justify-between gap-8 bg-[#2f4038] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer">
                                        <Image width="25" height="25" src="/icons/sale-03.svg" style={{ filter: "invert(67%) sepia(16%) saturate(975%) hue-rotate(95deg) brightness(93%) contrast(92%)" }} alt={''}></Image>
                                        <p className="font-medium">Add Cart Discount</p>
                                    </div>
            
                                    <div 
                                        onClick={() => {
                                            if(customerState) setPadState("ship-to-customer")
                                        }}
                                        className={`flex flex-col justify-between gap-8  ${customerState ? "bg-[#243a4e]" : "bg-[#101921]"} backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer`}>
                                        <Image width="25" height="25" src="/icons/globe-05.svg" style={{ filter: customerState ? "invert(70%) sepia(24%) saturate(4431%) hue-rotate(178deg) brightness(86%) contrast(78%)" : "invert(46%) sepia(7%) saturate(675%) hue-rotate(182deg) brightness(94%) contrast(93%)" }} alt={''}></Image>
                                        <p className={`${customerState ? "text-white" : "text-gray-500"} font-medium`}>Ship to Customer</p>
                                    </div>
            
                                    <div 
                                        onClick={() => {
                                            setPadState("note")
                                        }}
                                        className="flex flex-col justify-between gap-8 bg-[#243a4e] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer">
                                        <Image width="25" height="25" src="/icons/file-plus-02.svg" style={{ filter: "invert(70%) sepia(24%) saturate(4431%) hue-rotate(178deg) brightness(86%) contrast(78%)" }} alt={''}></Image>
                                        <p className="font-medium">Add Note</p>
                                    </div>
            
                                    <div 
                                        onClick={() => {
                                            setPadState("pickup-from-store")
                                        }}
                                        className="flex flex-col justify-between gap-8 bg-[#243a4e] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer">
                                        <Image width="25" height="25" src="/icons/building-02.svg" style={{ filter: "invert(70%) sepia(24%) saturate(4431%) hue-rotate(178deg) brightness(86%) contrast(78%)" }} alt={''}></Image>
                                        <p className="font-medium">Pickup from Store</p>
                                    </div>
            
                                    <div className="flex flex-col justify-between gap-8 bg-[#2f4038] backdrop-blur-sm p-4 min-w-[250px] rounded-md text-white max-w-fit cursor-pointer">
                                        <Image width="25" height="25" src="/icons/save-01.svg" style={{ filter: "invert(67%) sepia(16%) saturate(975%) hue-rotate(95deg) brightness(93%) contrast(92%)" }} alt={''}></Image>
                                        <p className="font-medium">Save Cart</p>
                                    </div>
                                </div>
                    }
                </div>
                
                <div className="flex flex-row items-center border-t-2 border-gray-600">
                    {/* Active Orders */}
                    <div className="flex flex-row items-center gap-4 p-4 text-white border-r-2 border-gray-600">
                        <div className="bg-fuchsia-100 text-black p-2 px-[0.7rem] rounded-md font-bold">LK</div>
                        <div className="flex flex-col">
                            <h3>Leslie K.</h3>
                            <div className="flex flex-row items-center gap-[0.2rem]">
                                <p className="text-sm">5 items</p>
                                <p className="text-gray-400 text-sm">&#8226; Kiosk 5</p>
                            </div>
                        </div>
                        <br />
                        <Image width="25" height="25" src="/icons/expand-04.svg" alt={''}></Image>
                    </div>
                </div>
            </div>

            {
                (() => {
                    switch(padState) {
                        case "cart":
                            return (
                                <div className="bg-gray-900 min-w-[550px] max-w-[550px] p-6 flex flex-col h-full">
                                    <div className="flex flex-col gap-4 flex-1">
                                        {/* Order Information */}
                                        <div className="flex flex-row items-center justify-between">
                                            <div className="text-white">
                                                {
                                                    customerState ?
                                                    <div className="flex flex-row items-center gap-2">
                                                        <h2 className="font-semibold text-lg">{customerState.name}</h2>

                                                        <Image
                                                            onClick={() => {
                                                                setCustomerState(null)

                                                                setOrderState({
                                                                    ...orderState,
                                                                    products: orderState.products.map(e => {
                                                                        return {
                                                                            ...e,
                                                                            discount: e.discount.filter(e => e.source !== "loyalty")
                                                                        }
                                                                    })
                                                                })
                                                            }} 
                                                            className="cursor-pointer" height={15} width={15} src="/icons/x-2.svg" alt="" style={{ filter: "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)" }}></Image>
                                                    </div>
                                                    :
                                                    <div 
                                                        onClick={() => {
                                                            setResult([]); 
                                                            setSearchType("customer");    

                                                            input_ref.current?.value ? input_ref.current.value = "" : {};
                                                            input_ref.current?.focus()
                                                        }}
                                                        className="bg-gray-800 rounded-md px-2 py-[0.1rem] flex flex-row items-center gap-2 cursor-pointer">
                                                        <p>Select Customer</p>
                                                        <Image 
                                                            className=""
                                                            height={15} width={15} src="/icons/arrow-narrow-right.svg" alt="" style={{ filter: "invert(100%) sepia(5%) saturate(7417%) hue-rotate(235deg) brightness(118%) contrast(101%)" }}></Image>
                                                    </div>
                                                }
                                                <p className="text-sm text-gray-400">{
                                                        orderState.products.reduce((prev, curr) => { return prev + curr.quantity }, 0) == 0
                                                        ? 
                                                        "Cart Empty" 
                                                        : 
                                                        <p>
                                                            {orderState.products.reduce((prev, curr) => { return prev + curr.quantity }, 0)} item{(orderState.products.reduce((prev, curr) => { return prev + curr.quantity }, 0) > 1 ? "s" : "")}
                                                        </p>
                                                }</p>
                                            </div>

                                            <div className="flex flex-row items-center gap-[0.75rem] bg-gray-800 p-2 px-4 rounded-md cursor-pointer">
                                                <p className="text-white" onClick={() => {
                                                    setOrderState({
                                                        ...orderState,
                                                        products: []
                                                    })
                                                }}>Clear Cart</p>
                                                {/* <Image style={{ filter: "invert(100%) sepia(12%) saturate(7454%) hue-rotate(282deg) brightness(112%) contrast(114%)" }} width="25" height="25" src="/icons/x-square.svg" alt={''}></Image> */}
                                            </div>
                                        </div>
                                        

                                        <hr className="border-gray-400 opacity-25"/>
                                        
                                        <div className="flex flex-col flex-1 h-full gap-4">
                                        {
                                            orderState.products.length <= 0 ?
                                            <div className="flex flex-col items-center w-full">
                                                <p className="text-sm text-gray-400 py-4 select-none">No products in cart</p>
                                            </div>
                                            :
                                            orderState.products.map(e => {
                                                // Find the variant of the product for name and other information...
                                                return (
                                                    <div key={e.id} className="text-white">
                                                        <div className="flex flex-row items-center gap-4">
                                                            <div className="relative">
                                                                <Image height={60} width={60} quality={100} alt="Torq Surfboard" className="rounded-sm" src={e.variant_information.images[0]}></Image>

                                                                {
                                                                    // Determine the accurate representation of a non-diminishing item.
                                                                    e.variant_information.stock_information.non_diminishing ?
                                                                    <div className="bg-gray-600 rounded-full flex items-center justify-center h-[30px] w-[minmax(30px, 100%)] px-1 min-h-[30px] min-w-[30px] absolute -top-3 -right-3 border-gray-900 border-4">{e.quantity}</div>
                                                                    :
                                                                    <div className="bg-gray-600 rounded-full flex items-center justify-center h-[30px] w-[minmax(30px, 100%)] px-1 min-h-[30px] min-w-[30px] absolute -top-3 -right-3 border-gray-900 border-4">{e.quantity}</div>
                                                                }
                                                            </div>

                                                            <div className="flex flex-col gap-2 items-center justify-center">
                                                                <Image
                                                                    onClick={() => {
                                                                        if(!((orderState.products.find(k => k.id == e.id)?.quantity ?? 1) >= (orderState.products.find(k => k.id == e.id)?.variant_information.stock.find(e => e.store.code == master_state.store_id)?.quantity.quantity_on_hand ?? 1))) {
                                                                            let product_list_clone = orderState.products.map(k => {
                                                                                console.log(k, e.product_code);
                                                                                if(k.product_code == e.product_code && isEqual(k.variant, e.variant)) {
                                                                                    return {
                                                                                        ...k,
                                                                                        quantity: k.quantity+1
                                                                                    }
                                                                                }else {
                                                                                    return k
                                                                                }
                                                                            })
    
                                                                            setOrderState({
                                                                                ...orderState,
                                                                                products: product_list_clone
                                                                            })
                                                                        }
                                                                    }} 
                                                                    onMouseOver={(v) => {
                                                                        if(!((orderState.products.find(k => k.id == e.id)?.quantity ?? 1) >= (orderState.products.find(k => k.id == e.id)?.variant_information.stock.find(e => e.store.code == master_state.store_id)?.quantity.quantity_on_hand ?? 1)))
                                                                            v.currentTarget.style.filter = "invert(94%) sepia(0%) saturate(24%) hue-rotate(45deg) brightness(105%) contrast(105%)";
                                                                    }}
                                                                    onMouseLeave={(v) => {
                                                                        v.currentTarget.style.filter = "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)";
                                                                    }}
                                                                    draggable="false"
                                                                    className="select-none"
                                                                    src={
                                                                        (orderState.products.find(k => k.id == e.id)?.quantity ?? 1) >= (orderState.products.find(k => k.id == e.id)?.variant_information.stock.find(e => e.store.code == master_state.store_id)?.quantity.quantity_on_hand ?? 1) ? 
                                                                        "/icons/slash-octagon.svg" 
                                                                        : 
                                                                        "/icons/arrow-block-up.svg"
                                                                    } 
                                                                    width="15" height="15" alt={''} style={{ filter: "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)" }} ></Image>
                                                                <Image
                                                                    onClick={() => {
                                                                        let product_list_clone = orderState.products.map(k => {
                                                                            console.log(k, e.product_code);
                                                                            if(k.id == e.id) {
                                                                                if(k.quantity <= 1) {
                                                                                    return null;
                                                                                }else {
                                                                                    return {
                                                                                        ...k,
                                                                                        quantity: k.quantity-1
                                                                                    }
                                                                                }
                                                                            }else {
                                                                                return k
                                                                            }
                                                                        })

                                                                        setOrderState({
                                                                            ...orderState,
                                                                            products: product_list_clone.filter(k => k) as ProductPurchase[]
                                                                        })
                                                                    }} 
                                                                    draggable="false"
                                                                    className="select-none"
                                                                    onMouseOver={(b) => {
                                                                        b.currentTarget.style.filter = (orderState.products.find(k => k.id == e.id)?.quantity ?? 1) <= 1 ? 
                                                                        "invert(86%) sepia(34%) saturate(4038%) hue-rotate(295deg) brightness(88%) contrast(86%)"
                                                                        : 
                                                                        "invert(94%) sepia(0%) saturate(24%) hue-rotate(45deg) brightness(105%) contrast(105%)";
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.filter = "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)";
                                                                    }}
                                                                    width="15" height="15" src={
                                                                        (orderState.products.find(k => k.id == e.id)?.quantity ?? 1) <= 1 ? 
                                                                        "/icons/x-close.svg" 
                                                                        : 
                                                                        "/icons/arrow-block-down.svg"
                                                                    } alt={''} style={{ filter: "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)" }}></Image>
                                                            </div>
                                                            
                                                            <div className="flex-1">
                                                                <p className="font-semibold">{e.product.company} {e.product.name}</p>
                                                                <p className="text-sm text-gray-400">{e.variant_information.name}</p>
                                                            </div>

                                                            <div className="flex flex-row items-center gap-2">
                                                                <Image 
                                                                    onClick={() => {
                                                                        setPadState("discount");
                                                                        setDiscount({
                                                                            ...stringValueToObj(findMaxDiscount(e.discount, e.product_cost, false).value),
                                                                            product: e.variant_information,
                                                                            for: "product",
                                                                            exclusive: false
                                                                        })
                                                                    }}
                                                                    style={{ filter: "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)" }} height={20} width={20} alt="Discount" className="rounded-sm hover:cursor-pointer" src="/icons/sale-03.svg" 
                                                                    onMouseOver={(e) => {
                                                                        e.currentTarget.style.filter = "invert(94%) sepia(0%) saturate(24%) hue-rotate(45deg) brightness(105%) contrast(105%)";
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.filter = "invert(59%) sepia(9%) saturate(495%) hue-rotate(175deg) brightness(93%) contrast(95%)";
                                                                    }}
                                                                ></Image>
                                                            </div>

                                                            <div className="min-w-[75px] flex flex-col items-center">
                                                                {
                                                                    applyDiscount(e.variant_information.retail_price, findMaxDiscount(e.discount, e.variant_information.retail_price, !(!customerState)).value) == e.variant_information.retail_price ?
                                                                    <p>${(e.variant_information.retail_price * 1.15).toFixed(2)}</p>
                                                                    :
                                                                    <>
                                                                        <p className="text-gray-500 line-through text-sm">${(e.variant_information.retail_price * 1.15).toFixed(2)}</p>
                                                                        <p className={`${findMaxDiscount(e.discount, e.variant_information.retail_price, !(!customerState)).source == "loyalty" ? "text-indigo-300" : ""}`}>${((applyDiscount(e.variant_information.retail_price  * 1.15, findMaxDiscount(e.discount, e.variant_information.retail_price, !(!customerState)).value) ?? 1)).toFixed(2)}</p>
                                                                    </>
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        }
                                        </div>

                                        <hr className="border-gray-400 opacity-25"/>
                                        
                                        <div className="flex flex-row items-center text-white justify-between px-2">
                                            <div>
                                                <p className="text-gray-400 font-bold">Sub Total</p>
                                                <p className="text-gray-600 font-bold">Tax</p>
                                                <p className="font-bold text-lg">Total</p>
                                            </div>
                                            
                                            <div className="flex flex-col gap-0">
                                                {/* {
                                                    applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, curr.discount)
                                                    }, 0), orderState.discount) == orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, curr.discount)
                                                    }, 0) ?
                                                        <></>
                                                        :
                                                        <p>${orderState.products.reduce(function (prev, curr) {
                                                            return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, curr.discount)
                                                        }, 0)}</p>
                                                } */}
                                                <p className="text-gray-400 font-bold items-end self-end">
                                                    ${
                                                        applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                            return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                        }, 0), orderState.discount).toFixed(2)
                                                    } {applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                    }, 0), orderState.discount) == orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                    }, 0) ?
                                                        <></>
                                                        :
                                                        `(-${parseDiscount(orderState.discount)})`
                                                    }
                                                </p>
                                                <p className="text-gray-600 font-bold items-end self-end">+15% (${
                                                    (applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                    }, 0), orderState.discount) * 0.15).toFixed(2)
                                                })</p>
                                                <p className="font-bold text-lg items-end self-end">
                                                ${
                                                    // (orderState.products.reduce(function (prev, curr) {
                                                    //     return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, curr.discount)
                                                    // }, 0) * 1.15).toFixed(2)
                                                    (applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                    }, 0), orderState.discount) * 1.15).toFixed(2)
                                                }
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-row items-center gap-4">
                                            <div className={`bg-gray-300 w-full rounded-md p-4 flex items-center justify-center cursor-pointer ${orderState.products.length > 0 ? "" : "bg-opacity-10 opacity-20"}`}>
                                                <p className="text-blue-500 font-semibold">Park Sale</p>
                                            </div>

                                            <div
                                                onClick={() => {
                                                    setPadState("select-payment-method");

                                                    let price = (applyDiscount(orderState.products.reduce(function (prev, curr) {
                                                        return prev + applyDiscount(curr.variant_information.retail_price * curr.quantity, findMaxDiscount(curr.discount, curr.variant_information.retail_price, !(!customerState)).value)
                                                    }, 0), orderState.discount) * 1.15).toFixed(2);

                                                    setKioskState({
                                                        ...kioskState,
                                                        order_total: parseFloat(price)
                                                    })

                                                    setCurrentTransactionPrice(parseFloat(price));
                                                }} 
                                                className={`${orderState.products.length > 0 ? "bg-blue-700 cursor-pointer" : "bg-blue-700 bg-opacity-10 opacity-20"} w-full rounded-md p-4 flex items-center justify-center`}>
                                                <p className={`text-white font-semibold ${""}`}>Checkout</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        case "select-payment-method":
                            return (
                                <PaymentMethod setPadState={setPadState} orderState={orderState} kioskState={kioskState} ctp={[ currentTransactionPrice, setCurrentTransactionPrice ]} />
                            )
                        case "await-debit":
                            // On completion of this page, ensure all payment segments are made, i.e. if a split payment is forged, return to the payment select screen with the new amount to complete the payment. 
                            return (
                                <div className="bg-blue-500 min-w-[550px] max-w-[550px] p-6 flex flex-col h-full items-center">
                                    <div className="flex flex-row justify-between cursor-pointer w-full">
                                        <div 
                                            onClick={() => {
                                                setPadState("select-payment-method")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left (1).svg" height={20} width={20} alt="" style={{ filter: "invert(100%) sepia(99%) saturate(0%) hue-rotate(119deg) brightness(110%) contrast(101%)" }} />
                                            <p className="text-white">Cancel</p>
                                        </div>
                                        <p className="text-white">Awaiting Customer Payment</p>
                                    </div>
                                    
                                    <div className="flex-1 flex flex-col items-center justify-center">
                                        <p className="text-white text-3xl font-bold">${currentTransactionPrice?.toFixed(2)}</p>
                                        <p className="text-gray-200">Tap, Insert or Swipe</p>
                                    </div>

                                    <p onClick={() => {
                                        let new_payment = [ ...kioskState.payment, {
                                            payment_method: "card",
                                            fulfillment_date: new Date().toString(),
                                            amount: currentTransactionPrice
                                        }];

                                        setKioskState({
                                            ...kioskState,
                                            payment: new_payment
                                        });

                                        let qua = new_payment.reduce(function (prev, curr) {
                                            return prev + (curr.amount ?? 0)
                                        }, 0);

                                        console.log("Total Paid:", qua);

                                        if(qua < (kioskState.order_total ?? 0)) {
                                            setCurrentTransactionPrice((kioskState.order_total ?? 0) - qua)
                                            setPadState("select-payment-method")
                                        }else {
                                            setPadState("completed");

                                            let date = new Date().toString();

                                            // Following state change is for an in-store purchase, modifications to status and destination are required for shipments
                                            setOrderState({
                                                ...orderState,
                                                origin: {
                                                    code: master_state.store_id,
                                                    contact: master_state.store_contact
                                                },
                                                destination: {
                                                    code: "cust",
                                                    contact: customerState?.contact ?? master_state.store_contact
                                                },
                                                status: [
                                                    ...orderState.status,
                                                    {   
                                                        status: "fulfilled",
                                                        assigned_products: orderState.products.map<string>(e => { return e.product_code + "-" + e.variant.join("-") }) as string[],
                                                        timestamp: date
                                                    }
                                                ],
                                                status_history: [
                                                    ...orderState.status_history,
                                                    [
                                                        ...orderState.status,
                                                        {   
                                                            status: "fulfilled",
                                                            assigned_products: orderState.products.map<string>(e => { return e.product_code + "-" + e.variant.join("-") }) as string[],
                                                            timestamp: date
                                                        }
                                                    ]
                                                ]
                                                
                                            })
                                        }
                                    }}>skip to completion</p>
                                </div>
                            )
                        case "completed":
                            return (
                                <div className="bg-gray-900 min-w-[550px] max-w-[550px] p-6 flex flex-col h-full gap-4">
                                    <div>
                                        <p className="text-gray-600">{customerState?.name ?? "Guest"}</p>
                                        <p className="text-white font-bold text-2xl">${kioskState.order_total}</p>
                                    </div>

                                    <div className="flex flex-col flex-1 gap-2">
                                        {
                                            orderState.products?.map(e => {
                                                return (
                                                    <div key={`PRD${e.product_code}-${e.variant}`} className="flex flex-row items-center gap-8">
                                                        <p className="text-white font-bold">{e.quantity}</p>

                                                        <div className="flex flex-col gap-0 flex-1">
                                                            <p className="text-white">{e.product.name}</p>
                                                            <p className="text-gray-600">{e.variant_information.name}</p>
                                                        </div>

                                                        <p className="text-white">${applyDiscount(e.variant_information.retail_price * 1.15, findMaxDiscount(e.discount, e.variant_information.retail_price, !(!customerState)).value)?.toFixed(2)}</p>
                                                    </div>
                                                )
                                            })
                                        }
                                    </div>
                                    
                                    <p className="text-gray-600">RECEIPT OPTIONS</p>
                                    <div className="flex flex-row items-center justify-between">
                                        <p className="bg-gray-700 text-white px-4 py-2 rounded-md cursor-pointer">Print receipt</p>
                                        
                                        {
                                            customerState?.contact.email ?
                                            <p className="bg-gray-700 text-white px-4 py-2 rounded-md cursor-pointer">Email receipt</p>
                                            :
                                            <p className="bg-gray-800 text-gray-400 px-4 py-2 rounded-md select-none">Email receipt</p>
                                        }

                                        {
                                            customerState?.contact.mobile ?
                                            <p className="bg-gray-700 text-white px-4 py-2 rounded-md cursor-pointer">Text receipt</p>
                                            :
                                            <p className="bg-gray-800 text-gray-400 px-4 py-2 rounded-md select-none">Text receipt</p>
                                        }
                                        
                                        <p className="bg-gray-700 text-white px-4 py-2 rounded-md cursor-pointer">Gift receipt</p>
                                    </div>

                                    <div className="flex flex-row items-center gap-4">
                                        <div
                                            onClick={() => {
                                                setKioskState({
                                                    customer: null,
                                                    transaction_type: "OUT",
                                                    products: [],
                                                    order_total: null,
                                                    payment: [],
                                                    order_date: null,
                                                    order_notes: null,
                                                    order_history: null,
                                                    salesperson: null,
                                                    till: null
                                                })
                                                
                                                setOrderState({
                                                    id: v4(),
                                                    destination: null,
                                                    origin: {
                                                        contact: master_state.store_contact,
                                                        code: master_state.store_id
                                                    },
                                                    products: [],
                                                    status: [],
                                                    status_history: [],
                                                    order_history: [],
                                                    order_notes: [],
                                                    reference: "",
                                                    creation_date: Date.now().toString(),
                                                    discount: "a|0"
                                                })
                                                
                                                setCustomerState(null)
                                            
                                                setPadState("cart")
                                            }} 
                                            className={`${orderState.products.length > 0 ? "bg-blue-700 cursor-pointer" : "bg-blue-700 bg-opacity-10 opacity-20"} w-full rounded-md p-4 flex items-center justify-center`}>
                                            <p className={`text-white font-semibold ${""}`}>Complete</p>
                                        </div>
                                    </div>
                                </div>
                            )
                        case "discount":
                            return (
                                <div className="bg-gray-900 min-w-[550px] max-w-[550px] p-6 flex flex-col h-full justify-between flex-1">
                                    <div className="flex flex-row justify-between cursor-pointer">
                                        <div 
                                            onClick={() => {
                                                setPadState("cart")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left.svg" height={20} width={20} alt="" />
                                            <p className="text-gray-400">Back</p>
                                        </div>
                                        <p className="text-gray-400">Select Discount</p>
                                    </div>

                                    <DiscountMenu discountGroup={[ discount, setDiscount ]} callback={(dcnt: {
                                        type: "absolute" | "percentage",
                                        product: VariantInformation | null,
                                        value: number,
                                        for: "cart" | "product",
                                        exclusive: boolean
                                    }) => {
                                        setPadState("cart")

                                        if(dcnt.for == "product") {
                                            if(dcnt.exclusive) {
                                                let overflow_quantity = 0;
                                                let overflow_product: (ProductPurchase | null) = null;

                                                let new_products = orderState.products.map(e => {
                                                    if(e.variant_information.barcode == dcnt.product?.barcode) {
                                                        if(e.quantity > 1) {
                                                            overflow_quantity = e.quantity - 1
                                                            overflow_product = e
                                                        }

                                                        return {
                                                            ...e,
                                                            quantity: 1,
                                                            discount: [
                                                                // Will replace any currently imposed discounts
                                                                ...e.discount.filter(e => {
                                                                    return e.source !== "user"
                                                                }),
                                                                {
                                                                    source: "user",
                                                                    value: `${dcnt.type == "absolute" ? "a" : "p"}|${dcnt.value}` 
                                                                } as DiscountValue
                                                            ]
                                                        };
                                                    } else return e;
                                                });

                                                if(overflow_product !== null) {
                                                    new_products.push({
                                                        ...overflow_product as ProductPurchase,
                                                        quantity: overflow_quantity,
                                                        id: v4()
                                                    })
                                                }

                                                setOrderState({
                                                    ...orderState,
                                                    products: new_products
                                                })
                                            }else {
                                                let new_products = orderState.products.map(e => {
                                                    if(e.variant_information.barcode == dcnt.product?.barcode) {
                                                        return {
                                                            ...e,
                                                            discount: [
                                                                // Will replace any currently imposed discounts
                                                                ...e.discount.filter(e => {
                                                                    return e.source !== "user"
                                                                }),
                                                                {
                                                                    source: "user",
                                                                    value: `${dcnt.type == "absolute" ? "a" : "p"}|${dcnt.value}` 
                                                                } as DiscountValue
                                                            ]
                                                        };
                                                    } else return e;
                                                });

                                                setOrderState({
                                                    ...orderState,
                                                    products: new_products
                                                })
                                            }
                                        }else {
                                            setOrderState({
                                                ...orderState,
                                                discount: `${dcnt.type == "absolute" ? "a" : "p"}|${dcnt.value}`
                                            })
                                        }
                                    }} multiple={orderState.products.length > 0} />
                                </div>
                            )
                        case "await-cash":
                            // On completion of this page, ensure all payment segments are made, i.e. if a split payment is forged, return to the payment select screen with the new amount to complete the payment. 
                            return (
                                <div className="bg-blue-500 min-w-[550px] max-w-[550px] p-6 flex flex-col h-full items-center">
                                    <div className="flex flex-row justify-between cursor-pointer w-full">
                                        <div 
                                            onClick={() => {
                                                setPadState("select-payment-method")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left (1).svg" height={20} width={20} alt="" style={{ filter: "invert(100%) sepia(99%) saturate(0%) hue-rotate(119deg) brightness(110%) contrast(101%)" }} />
                                            <p className="text-white">Back</p>
                                        </div>
                                        <p className="text-white">Awaiting Customer Payment</p>
                                    </div>
                                    
                                    <CashSelect totalCost={currentTransactionPrice ?? 0} changeCallback={(_val: number, deg: number) => {
                                        setCashContinuable(deg >= 0)
                                    }} />

                                    <div className="flex w-full flex-row items-center gap-4 cursor-pointer">
                                        <div
                                            className={`${cashContinuable ? "bg-white" : "bg-blue-400"} w-full rounded-md p-4 flex items-center justify-center`}
                                            onClick={() => {
                                                let new_payment = [ ...kioskState.payment, {
                                                    payment_method: "cash",
                                                    fulfillment_date: new Date().toString(),
                                                    amount: currentTransactionPrice
                                                }];
        
                                                setKioskState({
                                                    ...kioskState,
                                                    payment: new_payment
                                                });
        
                                                let qua = new_payment.reduce(function (prev, curr) {
                                                    return prev + (curr.amount ?? 0)
                                                }, 0);
        
                                                console.log("Total Paid:", qua);
        
                                                if(qua < (kioskState.order_total ?? 0)) {
                                                    setCurrentTransactionPrice((kioskState.order_total ?? 0) - qua)
                                                    setPadState("select-payment-method")
                                                }else {
                                                    setPadState("completed")
                                                }
                                            }}
                                            >
                                            <p className={`${cashContinuable ? "text-blue-600" : "text-blue-500"} font-semibold ${""}`}>Complete</p>
                                        </div>
                                    </div>
                                </div>
                            )
                        case "note":
                            return (
                                <div className="bg-gray-900 max-h-[calc(100vh - 18px)] min-w-[550px] max-w-[550px] p-6 flex flex-col h-full justify-between flex-1 gap-8">
                                    <div className="flex flex-row justify-between cursor-pointer">
                                        <div 
                                            onClick={() => {
                                                setPadState("cart")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left.svg" height={20} width={20} alt="" />
                                            <p className="text-gray-400">Back</p>
                                        </div>
                                        <p className="text-gray-400">Add Note</p>
                                    </div>
                                    
                                    <NotesMenu notes={orderState.order_notes} callback={(note: string) => {
                                        console.log(master_state.employee);
                                        
                                        if(master_state?.employee) {
                                            const note_obj: Note = {
                                                message: note,
                                                timestamp: new Date().toString(),
                                                author: master_state?.employee
                                            }
    
                                            setOrderState({
                                                ...orderState,
                                                order_notes: [
                                                    ...orderState.order_notes,
                                                    note_obj
                                                ]
                                            })
                                        }
                                    }} />
                                </div>
                            )
                        case "pickup-from-store":
                            return (
                                <div className="bg-gray-900 max-h-[calc(100vh - 18px)] min-w-[550px] max-w-[550px] p-6 flex flex-col h-full justify-between flex-1 gap-8">
                                    <div className="flex flex-row justify-between cursor-pointer">
                                        <div 
                                            onClick={() => {
                                                setPadState("cart")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left.svg" height={20} width={20} alt="" />
                                            <p className="text-gray-400">Back</p>
                                        </div>
                                        <p className="text-gray-400">Pickup from Store</p>
                                    </div>
                                    
                                    
                                </div>
                            )
                        case "ship-to-customer":
                            return (
                                <div className="bg-gray-900 max-h-[calc(100vh - 18px)] min-w-[550px] max-w-[550px] p-6 flex flex-col h-full justify-between flex-1 gap-8">
                                    <div className="flex flex-row justify-between cursor-pointer">
                                        <div 
                                            onClick={() => {
                                                setPadState("cart")
                                            }}
                                            className="flex flex-row items-center gap-2"
                                        >
                                            <Image src="/icons/arrow-narrow-left.svg" height={20} width={20} alt="" />
                                            <p className="text-gray-400">Back</p>
                                        </div>
                                        <p className="text-gray-400">Ship to Customer</p>
                                    </div>
                                    
                                    {
                                        customerState ? 
                                        <DispatchMenu orderJob={[ orderState, setOrderState ]} customerJob={[ customerState, setCustomerState ]} />
                                        :
                                        <div className="flex items-center justify-center flex-1 gap-8 flex-col">
                                            <p className="text-gray-400">Must have an assigned customer to send products.</p>

                                            <div 
                                                onClick={() => {
                                                    setResult([]); 
                                                    setSearchType("customer");    

                                                    input_ref.current?.value ? input_ref.current.value = "" : {};
                                                    input_ref.current?.focus()
                                                }}
                                                className="bg-gray-800 text-white rounded-md px-2 py-[0.1rem] flex flex-row items-center gap-2 cursor-pointer">
                                                <p>Select Customer</p>
                                                <Image 
                                                    className=""
                                                    height={15} width={15} src="/icons/arrow-narrow-right.svg" alt="" style={{ filter: "invert(100%) sepia(5%) saturate(7417%) hue-rotate(235deg) brightness(118%) contrast(101%)" }}></Image>
                                            </div>
                                        </div>
                                    }
                                </div>
                            )
                    }
                })()
            }
        </>
    )
}