import Image from "next/image";
import { useState, FC, useRef, createRef } from "react";
import { Note } from "./stock-types";

const NotesMenu: FC<{ notes: Note[], callback: Function }> = ({ notes, callback }) => {
    const input_ref = createRef<HTMLInputElement>();

    return (
        <div className="flex flex-1 flex-col gap-8">
            <div className="flex flex-col flex-1 items-center justify-between">
                {
                    notes.length == 0 ? 
                    <p className="text-gray-600">No notes yet</p>
                    :
                    notes.map(e => {
                        return (
                            <div className="flex flex-row items-center justify-between" key={`${e.timestamp}-${e.message}`}>
                                {e.message}
                            </div>
                        )
                    })
                }
            </div>

            <hr className="border-gray-400 opacity-25"/>
            
            <div className="flex flex-col justify-center gap-4 bg-gray-700 rounded-sm">
                <div className="flex flex-1 flex-row items-center justify-between gap-4 px-2 pr-4">
                    <input 
                        ref={input_ref}
                        onKeyDown={(e) => {
                            if(e.key == "Enter") {
                                callback(input_ref.current?.value ?? "")
                            }
                        }}
                        placeholder={"Order Note"}
                        autoFocus className="flex-1 text-white py-4 px-2 rounded-md bg-transparent outline-none" type="text" />
                    
                    <Image
                        onClick={() => {
                            callback(input_ref.current?.value ?? "")
                        }} 
                        width="22" height="22" src="/icons/arrow-square-right.svg" style={{ filter: "invert(58%) sepia(32%) saturate(152%) hue-rotate(176deg) brightness(91%) contrast(87%)" }} className="select-none" alt={''} draggable={false}></Image>
                </div>
            </div>
        </div>
    )
}

export default NotesMenu;